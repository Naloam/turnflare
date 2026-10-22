/**
 * @turnflare/api —— 仓储的共享依赖。
 *
 * 读写两侧必须拿到**同一批**预编译语句和同一个连接：prepare 有开销，只备一次；
 * 而事务挂在哪个连接上，就只能看见那个连接刚写进去的行。把它们收成一个只读的
 * `RepositoryDeps`，读写函数就不必各自持有 db，也不会出现两条连接各写一半。
 *
 * 跨侧流转的值类型（FileStamp / SessionTimeRange）也放这里：它们是公开契约的
 * 一部分，却要被 write 与 read 两个模块同时引用，放任何一侧都会多一条回头路。
 */

import type Database from 'better-sqlite3'
import {
  SQL_COUNT_SESSIONS,
  SQL_COUNT_SIDECHAIN_TURNS,
  SQL_COUNT_TURNS,
  SQL_INSERT_TOOL_INVOCATION,
  SQL_INSERT_TURN,
  SQL_SELECT_ACTIVITY_RANGE,
  SQL_SELECT_FILE_STAMPS,
  SQL_UPSERT_FILE_STAMP,
  SQL_SELECT_LAST_SCAN_AT,
  SQL_SELECT_MODEL_STATS,
  SQL_SELECT_ONE_SESSION_MODEL_USAGE,
  SQL_SELECT_PROJECT_STATS,
  SQL_SELECT_SESSION_AGGREGATE,
  SQL_SELECT_SESSION_BY_ID,
  SQL_SELECT_SESSION_MODELS,
  SQL_SELECT_SESSION_MODELS_FOR_MERGE,
  SQL_SELECT_SESSION_TOOLS,
  SQL_SELECT_SESSION_CHAIN_COUNTS,
  SQL_SELECT_SESSION_TURNS,
  SQL_SELECT_SIDECHAIN_MODEL_USAGE,
  SQL_SELECT_TOOL_STATS,
  SQL_SELECT_USAGE_SUM,
  SQL_UPDATE_SESSION_AGGREGATE,
  SQL_UPSERT_SESSION,
} from './queries.js'

/** 启动时备一次、之后全程复用的预编译语句 */
export interface PreparedStatements {
  readonly upsertSession: Database.Statement
  readonly selectSessionAggregate: Database.Statement
  readonly selectSessionModels: Database.Statement
  readonly selectSessionModelsForMerge: Database.Statement
  readonly updateSessionAggregate: Database.Statement
  readonly insertTurn: Database.Statement
  readonly insertTool: Database.Statement
  readonly selectSessionById: Database.Statement
  readonly selectSessionTurns: Database.Statement
  readonly selectSessionChainCounts: Database.Statement
  readonly selectSessionTools: Database.Statement
  readonly selectOneSessionModelUsage: Database.Statement
  readonly countSessions: Database.Statement
  readonly countTurns: Database.Statement
  readonly countSidechainTurns: Database.Statement
  readonly selectUsageSum: Database.Statement
  readonly selectActivityRange: Database.Statement
  readonly selectModelStats: Database.Statement
  readonly selectSidechainModelUsage: Database.Statement
  readonly selectProjectStats: Database.Statement
  readonly selectToolStats: Database.Statement
  readonly selectFileStamps: Database.Statement
  readonly upsertFileStamp: Database.Statement
  readonly selectLastScanAt: Database.Statement
}

export function prepareStatements(db: Database.Database): PreparedStatements {
  return {
    upsertSession: db.prepare(SQL_UPSERT_SESSION),
    selectSessionAggregate: db.prepare(SQL_SELECT_SESSION_AGGREGATE),
    selectSessionModels: db.prepare(SQL_SELECT_SESSION_MODELS),
    selectSessionModelsForMerge: db.prepare(SQL_SELECT_SESSION_MODELS_FOR_MERGE),
    updateSessionAggregate: db.prepare(SQL_UPDATE_SESSION_AGGREGATE),
    insertTurn: db.prepare(SQL_INSERT_TURN),
    insertTool: db.prepare(SQL_INSERT_TOOL_INVOCATION),
    selectSessionById: db.prepare(SQL_SELECT_SESSION_BY_ID),
    selectSessionTurns: db.prepare(SQL_SELECT_SESSION_TURNS),
    selectSessionChainCounts: db.prepare(SQL_SELECT_SESSION_CHAIN_COUNTS),
    selectSessionTools: db.prepare(SQL_SELECT_SESSION_TOOLS),
    selectOneSessionModelUsage: db.prepare(SQL_SELECT_ONE_SESSION_MODEL_USAGE),
    countSessions: db.prepare(SQL_COUNT_SESSIONS),
    countTurns: db.prepare(SQL_COUNT_TURNS),
    countSidechainTurns: db.prepare(SQL_COUNT_SIDECHAIN_TURNS),
    selectUsageSum: db.prepare(SQL_SELECT_USAGE_SUM),
    selectActivityRange: db.prepare(SQL_SELECT_ACTIVITY_RANGE),
    selectModelStats: db.prepare(SQL_SELECT_MODEL_STATS),
    selectSidechainModelUsage: db.prepare(SQL_SELECT_SIDECHAIN_MODEL_USAGE),
    selectProjectStats: db.prepare(SQL_SELECT_PROJECT_STATS),
    selectToolStats: db.prepare(SQL_SELECT_TOOL_STATS),
    selectFileStamps: db.prepare(SQL_SELECT_FILE_STAMPS),
    upsertFileStamp: db.prepare(SQL_UPSERT_FILE_STAMP),
    selectLastScanAt: db.prepare(SQL_SELECT_LAST_SCAN_AT),
  }
}

/**
 * 读写函数共用的依赖。
 *
 * 只读且只构造一次：写侧重算汇总与读侧算总览看到的是同一份语句，统计口径才不会
 * 因为"各自备了一份"而漂移。
 */
export interface RepositoryDeps {
  readonly db: Database.Database
  readonly statements: PreparedStatements
}

/** 已入库文件的指纹，增量扫描靠它判断"这个文件要不要重新解析" */
export interface FileStamp {
  readonly filePath: string
  readonly mtimeMs: number
  readonly sizeBytes: number
}

/** 会话时间范围；合并时用来把 meta 里的时刻并进汇总 */
export interface SessionTimeRange {
  readonly startedAt: string | null
  readonly endedAt: string | null
}

/** 没有 meta 时间信息时的占位 */
export const EMPTY_TIME_RANGE: SessionTimeRange = Object.freeze({
  startedAt: null,
  endedAt: null,
})
