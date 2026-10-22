/**
 * @turnflare/api —— 仓储的读取路径。
 *
 * 只做"取数 + 折叠"：SQL 负责按维度归拢，这里把行折叠成 types.ts 声明的领域
 * 对象。统计口径（去重、排除侧链、排除合成记录）全部在 core 与 mapper 里，本
 * 文件不再实现一遍。
 *
 * 唯一的例外是侧链汇总（readSidechainSummary）：它刻意**并行于**主链口径存在，
 * 只往 AggregatedStats 上多挂一份，不改主链任何一个字段的语义。
 *
 * 成本为什么在读取时才算：schema 只存了总额，混合模型的会话反推不出四个分项，
 * 只能回 turns 表按模型重算（见 helpers 的 costCalculator）。
 */

import { cacheHitRate, toolErrorRate } from '@turnflare/core'
import type {
  AggregatedStats,
  ModelStats,
  ProjectStats,
  SessionDetail,
  SessionChain,
  SessionListItem,
  SessionsQuery,
  SidechainSummary,
  TimeBucket,
  TimelineQuery,
  TokenUsage,
  ToolStats,
} from '../types.js'
import type { FileStamp, RepositoryDeps } from './repository-deps.js'
import {
  emptyCostBreakdown,
  foldCosts,
  foldModelStats,
  foldUsage,
  groupRowsBy,
  readCount,
  asRecord,
  readIntegerFrom,
  readTextFieldFrom,
  sumRequestCount,
  toFileStamp,
  toProjectStats,
  toSessionListItem,
  toTimeBucket,
  toTokenUsage,
  toToolStats,
  toTurn,
} from './mapper.js'
import {
  compareModelStats,
  compareProjects,
  toCostBySession,
  toToolsByTurn,
} from './repository-helpers.js'
import {
  MAX_TURNS_PER_SESSION,
  buildSessionsStatements,
  buildTimelineStatement,
  normalizeSessionsQuery,
} from './queries.js'

export function readModelStats(deps: RepositoryDeps): readonly ModelStats[] {
  return foldModelStats(deps.statements.selectModelStats.all()).toSorted(compareModelStats)
}

export function readProjectStats(deps: RepositoryDeps): readonly ProjectStats[] {
  const rows = deps.statements.selectProjectStats.all()
  return [...groupRowsBy(rows, 'project_slug')]
    .map(([projectSlug, projectRows]) => toProjectStats(projectSlug, projectRows))
    .toSorted(compareProjects)
}

export function readTimeline(deps: RepositoryDeps, query: TimelineQuery): readonly TimeBucket[] {
  const statement = buildTimelineStatement(query)
  const rows = deps.db.prepare(statement.sql).all(...statement.params)
  return [...groupRowsBy(rows, 'bucket')].map(([bucket, bucketRows]) =>
    toTimeBucket(bucket, bucketRows),
  )
}

/**
 * 侧链（subagent）活动的汇总。
 *
 * 为什么单独读一路而不是改主链口径：主链数字（sessions 行 + is_sidechain = 0）
 * 对应"我和 Claude 对话了多少轮"，是用户最直观的心智模型；而侧链占了真实用量的
 * 大头（实测 turn 数约 5.4 倍、输出 token 约 1.7 倍），不暴露就等于把大部分成本
 * 藏起来。所以两者**并列**上报，主链字段一个字都不改。
 *
 * 折叠复用 mapper 的 foldUsage / foldCosts / sumRequestCount，与 byModel 走同一
 * 套转换——转换逻辑只有一份，才不会出现"主链和侧链两套算法慢慢漂移"。
 *
 * 已知限制：`usage.serverToolUse` 恒为 0。turns 表没有这一列（服务端工具调用次数
 * 只在 sessions 行上留了一份主链汇总），侧链的那部分从未落库，无法在不改 schema
 * 的前提下还原。宁可给 0 也不猜一个数。
 */
export function readSidechainSummary(deps: RepositoryDeps): SidechainSummary {
  const modelRows = deps.statements.selectSidechainModelUsage.all()
  return {
    // turn 数含 user 消息；请求数只数 model IS NOT NULL 的计费 turn，与主链同口径
    turnCount: readCount(deps.statements.countSidechainTurns.get()),
    usage: foldUsage(modelRows),
    cost: foldCosts(modelRows),
    requestCount: sumRequestCount(modelRows),
  }
}

export function readOverview(deps: RepositoryDeps): AggregatedStats {
  const usageRow = deps.statements.selectUsageSum.get()
  const usage: TokenUsage = toTokenUsage(usageRow)
  const modelRows = deps.statements.selectModelStats.all()
  const toolUsage = deps.statements.selectToolStats.all().map(toToolStats)
  const activity = deps.statements.selectActivityRange.get()

  return {
    sessionCount: readCount(deps.statements.countSessions.get()),
    turnCount: readCount(deps.statements.countTurns.get()),
    usage,
    // 总成本按模型 × 档位重算后求和：总额存在 sessions 表里，但混合模型的会话
    // 没法从总额反推四个分项；而同一模型的 fast 档单价不同，也不能合并计价
    cost: foldCosts(modelRows),
    // 折叠之后必须自己排：SQL 的 ORDER BY 作用在 (model, speed) 拆分行上，
    // 一个模型被拆成几行之后就再也表达不了"这个模型的总成本排第几"。
    // 少了这一步，混合档位的模型会被排到只用一个档位的便宜模型后面——
    // 而 /api/stats/models（readModelStats）是排了的，两条接口会自相矛盾。
    byModel: foldModelStats(modelRows).toSorted(compareModelStats),
    byProject: readProjectStats(deps),
    byHour: readTimeline(deps, { granularity: 'hour' }),
    byDay: readTimeline(deps, { granularity: 'day' }),
    toolUsage,
    cacheHitRate: cacheHitRate(usage),
    errorRate: toolErrorRate(toolUsage),
    firstActivityAt: readTextFieldFrom(activity, 'first_activity_at'),
    lastActivityAt: readTextFieldFrom(activity, 'last_activity_at'),
    sidechain: readSidechainSummary(deps),
  }
}

export function readSessionDetail(
  deps: RepositoryDeps,
  sessionId: string,
  chain: SessionChain = 'all',
  page = 1,
): SessionDetail | null {
  const row = deps.statements.selectSessionById.get(sessionId)
  if (row === undefined) {
    return null
  }
  const costBySession = toCostBySession(deps.statements.selectOneSessionModelUsage.all(sessionId))
  const cost = costBySession.get(sessionId) ?? emptyCostBreakdown()
  const toolsByTurn = toToolsByTurn(deps.statements.selectSessionTools.all(sessionId))
  const turns = deps.statements.selectSessionTurns
    .all(
      sessionId,
      chain,
      chain === 'side' ? 1 : 0,
      MAX_TURNS_PER_SESSION,
      (Math.max(1, page) - 1) * MAX_TURNS_PER_SESSION,
    )
    .flatMap((turnRow) => {
      const turnUuid = readTextFieldFrom(turnRow, 'uuid')
      const tools = turnUuid === null ? [] : (toolsByTurn.get(turnUuid) ?? [])
      const turn = toTurn(turnRow, tools)
      return turn === null ? [] : [turn]
    })

  const item = toSessionListItem(row, cost)
  if (item === null) {
    return null
  }

  // 链条计数走独立 COUNT：turns 受 500 条上限截断且主链优先，
  // 数返回结果会在主链超限时误判"没有 subagent"
  const counts = asRecord(deps.statements.selectSessionChainCounts.get(sessionId))

  return {
    ...item,
    turns,
    chainCounts: {
      total: readIntegerFrom(counts, 'total'),
      main: readIntegerFrom(counts, 'main'),
      side: readIntegerFrom(counts, 'side'),
    },
    parseErrorCount: readIntegerFrom(row, 'parse_error_count'),
  }
}

export function readSessionsPage(
  deps: RepositoryDeps,
  query: SessionsQuery,
): { items: SessionListItem[]; total: number } {
  const normalized = normalizeSessionsQuery(query)
  const built = buildSessionsStatements(normalized)
  const offset = Math.max(0, normalized.page - 1) * normalized.limit
  // 三条语句都带过滤条件，只能现备现用；预编译的那份 count 没有 WHERE，
  // 塞过滤参数会直接报 "Too many parameter values"。
  const total = readCount(deps.db.prepare(built.count).get(...built.params))
  const rows = deps.db.prepare(built.page).all(...built.params, normalized.limit, offset)
  const costBySession = toCostBySession(deps.db.prepare(built.modelUsage).all(...built.params))

  const items = rows.flatMap((row) => {
    const sessionId = readTextFieldFrom(row, 'session_id')
    if (sessionId === null) {
      return []
    }
    const cost = costBySession.get(sessionId) ?? emptyCostBreakdown()
    const item = toSessionListItem(row, cost)
    return item === null ? [] : [item]
  })

  return { items, total }
}

export function readToolStats(deps: RepositoryDeps): readonly ToolStats[] {
  return deps.statements.selectToolStats.all().map(toToolStats)
}

export function readSessionCount(deps: RepositoryDeps): number {
  return readCount(deps.statements.countSessions.get())
}

export function readLastScanAt(deps: RepositoryDeps): string | null {
  return readTextFieldFrom(deps.statements.selectLastScanAt.get(), 'last_scan_at')
}

export function readFileStamps(deps: RepositoryDeps): readonly FileStamp[] {
  return deps.statements.selectFileStamps
    .all()
    .map(toFileStamp)
    .filter((stamp): stamp is NonNullable<typeof stamp> => stamp !== null)
}
