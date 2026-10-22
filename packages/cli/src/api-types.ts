/** Public API types used by the CLI; no dependency on build directory layout. */
import type {
  openDatabase,
  createRepository,
  loadConfig,
  collectReportData,
  renderReport,
  buildApp,
} from '@turnflare/api'

/** 打开数据库（必要时建目录、跑迁移） */
export type OpenDatabaseFn = typeof openDatabase
/** better-sqlite3 的连接；只作为不透明句柄在 CLI 内传递，不直接摸 SQL */
export type SqliteDatabase = ReturnType<OpenDatabaseFn>['db']
export type CreateRepositoryFn = typeof createRepository
/** 会话仓储：CLI 全部取数入口 */
export type SessionRepository = ReturnType<CreateRepositoryFn>
export type LoadConfigFn = typeof loadConfig
export type CollectReportDataFn = typeof collectReportData
export type RenderReportFn = typeof renderReport
export type BuildAppFn = typeof buildApp

export type { AppConfig } from '@turnflare/api'
export type { ReportPayload, RenderedReport } from '@turnflare/api'
export type { ScanInput, ScanOutcome } from '@turnflare/api'
export type {
  AggregatedStats,
  ModelStats,
  ProjectStats,
  SessionDetail,
  SessionListItem,
  SessionsQuery,
  SidechainSummary,
  TimeBucket,
  TimelineQuery,
  TokenUsage,
  ToolStats,
} from '@turnflare/api'
