/**
 * @turnflare/api —— 会话仓储。
 *
 * 一句话职责：把 core 解析出来的 `Session` 写进 SQLite，再把 SQLite 里的行
 * 读回 `packages/api/src/types.ts` 声明的领域对象。统计与成本的业务判断全部
 * 委托给 core（`aggregate` / `costOf`），本文件只做"落库"与"取数"。
 *
 * 实现按职责摊在四个文件里，本文件只剩公开契约与装配：
 *
 *   repository-deps.ts     共享依赖：连接、预编译语句、跨侧流转的值类型
 *   repository-helpers.ts  纯函数助手：行 ↔ 列值 / 领域对象、排序、时间取并集
 *   repository-write.ts    写入路径：落库、合并 turn、重算汇总、清表
 *   repository-read.ts     读取路径：列表、详情、各类统计
 *
 * 为什么拆：原来 6 个互不相关的读写闭包全塞在 createRepository 里，共享 db 与
 * statements，改一处得读懂全部。现在每个读写函数的签名里显式带着 deps，谁调用
 * 谁、依赖什么一眼能看出来；createRepository 退化成一个查表式的装配器。
 *
 * 两条贯穿全层的不变式：
 *   1. 幂等 —— 同一个 sessionId 反复写是 UPDATE 而不是报错，增量扫描才成立；
 *   2. 自洽 —— 所有聚合数字都从同一批 turn 行推导，会话级与分组级永远对得上。
 */

import type Database from 'better-sqlite3'
import type { Session, Turn } from '@turnflare/core'
import type {
  AggregatedStats,
  ModelStats,
  ProjectStats,
  SessionDetail,
  SessionChain,
  SessionListItem,
  SessionsQuery,
  TimeBucket,
  TimelineQuery,
  ToolStats,
} from '../types.js'
import type { FileStamp, RepositoryDeps, SessionTimeRange } from './repository-deps.js'
import { prepareStatements } from './repository-deps.js'
import {
  createClearAllTables,
  createMergeSessionTurns,
  upsertSessionRow,
} from './repository-write.js'
import {
  readFileStamps,
  readLastScanAt,
  readModelStats,
  readOverview,
  readProjectStats,
  readSessionCount,
  readSessionDetail,
  readSessionsPage,
  readTimeline,
  readToolStats,
} from './repository-read.js'

export type { FileStamp, SessionTimeRange } from './repository-deps.js'
export { costCalculator } from './repository-helpers.js'

export interface SessionRepository {
  /** 幂等写入：同一 sessionId 重复调用应为更新而非报错 */
  upsertSession(session: Session, stamp: FileStamp): void
  /**
   * 合并一批 turn 进会话（按 uuid 去重），并重算该会话汇总。
   *
   * 一个 sessionId 往往对应多个文件（主会话 + 各 subagent 记录），
   * 所以是合并而不是替换；meta 时间范围参与取并集。
   */
  mergeSessionTurns(sessionId: string, turns: readonly Turn[], meta?: SessionTimeRange): void
  getSession(sessionId: string, chain?: SessionChain, page?: number): SessionDetail | null
  listSessions(query: SessionsQuery): { items: SessionListItem[]; total: number }
  getOverview(): AggregatedStats
  getModelStats(): readonly ModelStats[]
  getProjectStats(): readonly ProjectStats[]
  getTimeline(query: TimelineQuery): readonly TimeBucket[]
  getToolStats(): readonly ToolStats[]
  countSessions(): number
  getLastScanAt(): string | null
  /** 已入库文件的 (filePath, mtimeMs, sizeBytes)，用于增量跳过 */
  getFileStamps(): readonly FileStamp[]
  clearAll(): void
}

/** 打开一个仓储实例；db 必须已经跑过迁移（openDatabase 会做） */
export function createRepository(db: Database.Database): SessionRepository {
  const deps: RepositoryDeps = { db, statements: prepareStatements(db) }

  return {
    upsertSession: (session, stamp) => upsertSessionRow(deps, session, stamp),
    mergeSessionTurns: createMergeSessionTurns(deps),
    getSession: (sessionId, chain, page) => readSessionDetail(deps, sessionId, chain, page),
    listSessions: (query) => readSessionsPage(deps, query),
    getOverview: () => readOverview(deps),
    getModelStats: () => readModelStats(deps),
    getProjectStats: () => readProjectStats(deps),
    getTimeline: (query) => readTimeline(deps, query),
    getToolStats: () => readToolStats(deps),
    countSessions: () => readSessionCount(deps),
    getLastScanAt: () => readLastScanAt(deps),
    getFileStamps: () => readFileStamps(deps),
    clearAll: createClearAllTables(deps),
  }
}
