/**
 * @turnflare/api —— 仓储的纯函数助手。
 *
 * 这里一律不碰连接、不抛业务异常：给定同样的行就给出同样的领域对象，可单独测。
 * 读写两侧都要用它们（行 → 列值、行 → 领域对象的折叠与排序），所以单独放一层，
 * 免得任一侧复制一份然后慢慢漂移。
 *
 * 成本为什么在这里算：schema 只持久化了成本**总额**，而一次会话/一个桶往往混用
 * 多个模型，总额反推不出四个分项。因此分项在读取时按模型重算，与 mapper 同源。
 */

import {
  aggregate,
  costOf,
  dedupeTurns,
  filterSyntheticModels,
  isSyntheticModel,
} from '@turnflare/core'
import type {
  CostBreakdown,
  CostCalculator,
  ModelStats,
  ProjectStats,
  Session,
  ToolInvocation,
  Turn,
} from '@turnflare/core'
import type { FileStamp } from './repository-deps.js'
import { emptyTokenUsage, foldCosts, groupRowsBy, toToolInvocation } from './mapper.js'

/**
 * 装配好的成本计算器。
 *
 * 这是 stats 与 cost 两个模块之间唯一的接缝：core 的 `aggregate` 接受注入的
 * `costCalculator`，这里把 `costOf` 包成它要的签名。扫描期算会话成本、读取期
 * 算分组成本走的是同一个计算器——两边的数字才可能对得上。
 */
export const costCalculator: CostCalculator = (usage, model) => costOf({ usage, model })

/**
 * 挑出要落库的 turn。
 *
 * 两条规则都不可省：
 *   1. 按 uuid 去重（保留首次）——compaction 会让同一条消息在 jsonl 里出现多次，
 *      而 `turns.uuid` 是主键，不去重会直接撞唯一约束；
 *   2. 剔掉合成哨兵记录——`<synthetic>` 不对应任何一次计费调用，混进来会让模型
 *      分布里出现一个不存在的模型。
 *
 * 侧链 turn 照常落库（`is_sidechain` 列就是用来区分的），只是不进任何主链统计
 * 口径；侧链活动由读路径单独汇总一份上报（见 queries.ts 的 SQL_SIDECHAIN_TURNS）。
 */
export function selectStorableTurns(turns: readonly Turn[]): readonly Turn[] {
  return dedupeTurns(turns).filter((turn) => !isSyntheticModel(turn.model))
}

/** 一次 turn 落库的列值，顺序与 SQL_INSERT_TURN 一致 */
export function toTurnRow(sessionId: string, turn: Turn): unknown[] {
  const usage = turn.usage ?? emptyTokenUsage()
  const cost = turn.usage === null ? 0 : costCalculator(turn.usage, turn.model ?? '').totalCost
  return [
    turn.uuid,
    sessionId,
    turn.lineNumber,
    turn.role,
    turn.timestamp,
    turn.model,
    turn.parentUuid,
    turn.isSidechain ? 1 : 0,
    turn.textPreview,
    usage.inputTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens,
    usage.outputTokens,
    usage.thinkingTokens,
    cost,
    usage.speed,
  ]
}

/**
 * 会话行 → 落库列值，顺序与 SQL_UPSERT_SESSION 一致。
 *
 * token 与成本取 `aggregate([session])` 的结果而不是自己累加 turn：聚合口径
 * （去重、排除侧链、排除合成记录）只有 core 一份实现，仓储再算一遍必然漂移。
 */
export function toSessionRow(session: Session, stamp: FileStamp, turnCount: number): unknown[] {
  const stats = aggregate([session], { costCalculator })
  return [
    session.meta.sessionId,
    session.meta.projectSlug,
    session.meta.filePath,
    session.meta.cwd,
    session.meta.gitBranch,
    session.meta.cliVersion,
    session.meta.startedAt,
    session.meta.endedAt,
    JSON.stringify(filterSyntheticModels(session.meta.models)),
    turnCount,
    stats.usage.inputTokens,
    stats.usage.cacheCreationTokens,
    stats.usage.cacheReadTokens,
    stats.usage.outputTokens,
    stats.usage.thinkingTokens,
    stats.usage.serverToolUse,
    stats.cost.totalCost,
    stats.cost.unpricedModel ? 1 : 0,
    session.parseErrors.length,
    stamp.mtimeMs,
    stamp.sizeBytes,
    new Date().toISOString(),
  ]
}

/** 把「按 (session_id, model) 汇总的行」折叠成每会话一份的成本明细 */
export function toCostBySession(rows: readonly unknown[]): Map<string, CostBreakdown> {
  const folded = new Map<string, CostBreakdown>()
  for (const [sessionId, sessionRows] of groupRowsBy(rows, 'session_id')) {
    folded.set(sessionId, foldCosts(sessionRows))
  }
  return folded
}

/** 把工具行按 turn_uuid 归拢，供 toTurn 挂回每条 turn */
export function toToolsByTurn(rows: readonly unknown[]): Map<string, readonly ToolInvocation[]> {
  const toolsByTurn = new Map<string, readonly ToolInvocation[]>()
  for (const [turnUuid, toolRows] of groupRowsBy(rows, 'turn_uuid')) {
    const tools = toolRows
      .map(toToolInvocation)
      .filter((tool): tool is ToolInvocation => tool !== null)
    toolsByTurn.set(turnUuid, tools)
  }
  return toolsByTurn
}

/** 项目分布按成本降序、slug 升序，与 core 的 aggregate 输出顺序一致 */
export function compareProjects(left: ProjectStats, right: ProjectStats): number {
  const byCost = right.cost.totalCost - left.cost.totalCost
  if (byCost !== 0) {
    return byCost
  }
  if (left.projectSlug < right.projectSlug) {
    return -1
  }
  return left.projectSlug > right.projectSlug ? 1 : 0
}

/**
 * 模型分布按成本降序、模型名升序。
 *
 * 折叠之后必须自己排：SQL 的 ORDER BY 作用在 (model, speed) 行上，一个模型被
 * 拆成几行之后就再也表达不了"这个模型的总成本排第几"。次级键同样不可省——
 * 大量模型成本并列时，没有唯一键的顺序取决于查询计划。
 */
export function compareModelStats(left: ModelStats, right: ModelStats): number {
  const byCost = right.cost.totalCost - left.cost.totalCost
  if (byCost !== 0) {
    return byCost
  }
  return left.model.localeCompare(right.model)
}

/** 取较早的时间戳；全部为空时返回 null。ISO-8601 UTC 串字典序即时间序 */
export function earliestTimestamp(...candidates: readonly (string | null)[]): string | null {
  const present = candidates.filter((value): value is string => value !== null && value !== '')
  return present.length === 0 ? null : (present.toSorted((a, b) => a.localeCompare(b))[0] ?? null)
}

/** 取较晚的时间戳；全部为空时返回 null */
export function latestTimestamp(...candidates: readonly (string | null)[]): string | null {
  const present = candidates.filter((value): value is string => value !== null && value !== '')
  return present.length === 0 ? null : (present.toSorted((a, b) => b.localeCompare(a))[0] ?? null)
}

/** 两个模型集合取并集，保持字典序，结果可复现 */
export function mergeModelLists(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return [...new Set([...left, ...right])].toSorted((a, b) => a.localeCompare(b))
}
