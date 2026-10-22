/**
 * @turnflare/api —— 仓储的写入路径。
 *
 * 只有三件事：把 core 解析出的 Session 落库、把一批 turn 合并进会话、清空所有表。
 * 汇总数字一律从 turns 表重算（见 recalculateSession 的说明），本文件不自己累加
 * ——聚合口径只有 core 一份实现，仓储再算一遍必然和读侧对不上。
 */

import type { Session, Turn } from '@turnflare/core'
import type { FileStamp, RepositoryDeps, SessionTimeRange } from './repository-deps.js'
import { EMPTY_TIME_RANGE } from './repository-deps.js'
import {
  asRecord,
  parseModels,
  readIntegerFrom,
  readNumberFrom,
  readTextFieldFrom,
} from './mapper.js'
import {
  earliestTimestamp,
  latestTimestamp,
  mergeModelLists,
  selectStorableTurns,
  toSessionRow,
  toTurnRow,
} from './repository-helpers.js'
// 重算汇总要用的四条语句已经由 prepareStatements 备好，走 deps.statements 拿；
// 这里只需要 SQL_CLEAR_ALL（清表是动态拼的多条 DELETE，没法预编译）。
import { SQL_CLEAR_ALL } from './queries.js'

/**
 * 落一条会话行。
 *
 * 只写 meta 与文件戳，不在这里重算汇总：turns 还没合进来，重算只会得到 0。
 * turn_count 用 MAX 语义保证单调不倒退，权威值由随后的合并里的
 * recalculateSession 给出。生产路径（Scanner）总是 upsert + 合并成对调用。
 */
export function upsertSessionRow(deps: RepositoryDeps, session: Session, stamp: FileStamp): void {
  const turnCount = selectStorableTurns(session.turns).length
  deps.statements.upsertSession.run(...toSessionRow(session, stamp, turnCount))
  // 文件指纹必须单独落一张表：sessions 以 session_id 为主键，而 subagent 文件
  // 复用父会话的 sessionId——写在同一行会让同一会话的十几个文件互相覆盖指纹，
  // 先扫的文件之后无论怎么改都被增量判定跳过。
  deps.statements.upsertFileStamp.run(
    stamp.filePath,
    session.meta.projectSlug,
    session.meta.sessionId,
    stamp.mtimeMs,
    stamp.sizeBytes,
    new Date().toISOString(),
  )
}

/**
 * 从 turns 表重算一个会话的汇总并写回 sessions 行。
 *
 * 为什么必须重算而不是用入参：一个 sessionId 往往对应十几个文件
 * （主会话 + 各 subagent 记录），后扫的文件只知道自己那部分 turn。
 * 只有从 turns 表全量聚合，得到的 turn_count / token 才是"这个会话完整的样子"。
 *
 * 时间范围与模型集合走**合并**而不是覆盖：turns 表里可能没有时间戳
 * （测试夹具、早期版本记录），而 meta 里带着；直接覆盖会把已经攒下的
 * 最早/最晚时刻抹掉。
 *
 * @param sessionId 会话 ID
 * @param metaStartedAt 本次 upsert 带来的起始时间，可为 null
 * @param metaEndedAt 本次 upsert 带来的结束时间，可为 null
 */
export function recalculateSession(
  deps: RepositoryDeps,
  sessionId: string,
  metaStartedAt: string | null,
  metaEndedAt: string | null,
): void {
  const aggregateRow = asRecord(deps.statements.selectSessionAggregate.get(sessionId)) ?? {}
  const turnModels = deps.statements.selectSessionModels
    .all(sessionId)
    .map((entry) => readTextFieldFrom(entry, 'model'))
    .filter((model): model is string => model !== null)

  const existing = asRecord(deps.statements.selectSessionModelsForMerge.get(sessionId)) ?? {}
  const existingModels = parseModels(readTextFieldFrom(existing, 'models'))

  // 时间取三方并集：turns 表派生的、本次 meta 带来的、库里已攒下的。
  // 少任何一方都会在多次扫描后丢时刻——只信 turns 会丢掉无时间戳的早期
  // 记录，只信 meta 会让后扫的文件覆盖掉更早的时刻。
  const startedAt = earliestTimestamp(
    readTextFieldFrom(aggregateRow, 'started_at'),
    metaStartedAt,
    readTextFieldFrom(existing, 'started_at'),
  )
  const endedAt = latestTimestamp(
    readTextFieldFrom(aggregateRow, 'ended_at'),
    metaEndedAt,
    readTextFieldFrom(existing, 'ended_at'),
  )

  deps.statements.updateSessionAggregate.run(
    readIntegerFrom(aggregateRow, 'turn_count'),
    readIntegerFrom(aggregateRow, 'input_tokens'),
    readIntegerFrom(aggregateRow, 'cache_creation_tokens'),
    readIntegerFrom(aggregateRow, 'cache_read_tokens'),
    readIntegerFrom(aggregateRow, 'output_tokens'),
    readIntegerFrom(aggregateRow, 'thinking_tokens'),
    readNumberFrom(aggregateRow, 'total_cost_usd'),
    startedAt,
    endedAt,
    JSON.stringify(mergeModelLists(existingModels, turnModels)),
    sessionId,
  )
}

/**
 * 合并一批 turn 进会话，然后重算汇总。
 *
 * 用 `ON CONFLICT (uuid) DO NOTHING`（SQL_INSERT_TURN）而不是先删后插：
 * compaction 会让同一条消息在同一个文件里出现多次，而 subagent 文件又和主会话
 * 共享 sessionId。先删后插会让"最后被扫到的文件"独占这个会话，把主会话几百条
 * turn 冲掉；按 uuid 去重的插入让多次扫描自然累积。
 *
 * 为什么不是 `INSERT OR IGNORE`：那个写法会忽略**所有**约束违规，
 * 包括 role 的 CHECK——一条畸形 turn 会被悄悄吞掉，落库少一行却没人知道。
 * `ON CONFLICT (uuid) DO NOTHING` 只对 uuid 主键冲突生效，别的问题仍然炸出来。
 *
 * 事务由调用方（createMergeSessionTurns）包：中途失败回滚到合并前，
 * 不会留下半套 turn。
 */
export function mergeTurnsInto(
  deps: RepositoryDeps,
  sessionId: string,
  turns: readonly Turn[],
  meta: SessionTimeRange,
): void {
  for (const turn of turns) {
    const outcome = deps.statements.insertTurn.run(toTurnRow(sessionId, turn))
    // changes === 0 说明这条 uuid 已入库：它的 tool_invocations 也早就跟着
    // 写过了，再插一遍会让工具统计翻倍。
    if (outcome.changes === 0) {
      continue
    }
    for (const tool of turn.tools) {
      deps.statements.insertTool.run([
        turn.uuid,
        tool.toolName,
        tool.toolUseId,
        tool.isError ? 1 : 0,
        tool.resultBytes,
      ])
    }
  }
  recalculateSession(deps, sessionId, meta.startedAt, meta.endedAt)
}

/**
 * 造出 mergeSessionTurns 方法：挑选要落库的 turn + 事务边界都在这里收尾，
 * 装配层只负责把它挂到接口上。
 *
 * 事务必须包住"插 turn + 重算汇总"整个动作：只插不重算会让 sessions 行停在旧
 * 数字上，而先重算后插则会读到还没写进去的 turn。
 */
export function createMergeSessionTurns(
  deps: RepositoryDeps,
): (sessionId: string, turns: readonly Turn[], meta?: SessionTimeRange) => void {
  const mergeInTransaction = deps.db.transaction(
    (sessionId: string, turns: readonly Turn[], meta: SessionTimeRange): void => {
      mergeTurnsInto(deps, sessionId, turns, meta)
    },
  )
  return (sessionId, turns, meta) => {
    mergeInTransaction(sessionId, selectStorableTurns(turns), meta ?? EMPTY_TIME_RANGE)
  }
}

/**
 * 造出 clearAll 方法。
 *
 * SQL_CLEAR_ALL 是多条 DELETE，必须包在同一个事务里：半途失败会留下"会话删了
 * 而 turn 还在"的空洞，此后的汇总数字再也对不上。
 */
export function createClearAllTables(deps: RepositoryDeps): () => void {
  return deps.db.transaction((): void => {
    for (const sql of SQL_CLEAR_ALL) {
      deps.db.prepare(sql).run()
    }
  })
}
