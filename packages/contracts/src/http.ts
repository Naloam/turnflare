import type { AggregatedStats, CostBreakdown, TimeBucket, TokenUsage, Turn } from './domain.js'

export type SessionChain = 'all' | 'main' | 'side'

/** 统一响应包络 */
export interface ApiResponse<T> {
  readonly success: boolean
  readonly data: T | null
  readonly error: string | null
  readonly meta?: ApiMeta
}

export interface ApiMeta {
  readonly total: number
  readonly page: number
  readonly limit: number
  readonly generatedAt: string
}

export interface HealthPayload {
  readonly name: string
  readonly version: string
  readonly dataRoot: string
  readonly sessionCount: number
  readonly lastScanAt: string | null
}

export interface SessionListItem {
  readonly sessionId: string
  readonly projectSlug: string
  readonly cwd: string | null
  readonly gitBranch: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly models: readonly string[]
  readonly turnCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
}

/**
 * 会话详情的链条计数。
 *
 * 为什么需要它：详情有 500 条上限，且排序是"主链优先"——主链一旦超过 500 条，
 * 侧链会被完全挤出返回结果。此时前端若用"返回的 turns 数组"统计链条分布，
 * 会认为这场会话没有 subagent，筛选器整条藏起来，用户也就再也不知道它的存在。
 * 服务端按全表计数，不受截断影响。
 */
export interface ChainCounts {
  readonly total: number
  readonly main: number
  readonly side: number
}

export interface SessionDetail {
  readonly sessionId: string
  readonly projectSlug: string
  readonly cwd: string | null
  readonly gitBranch: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly models: readonly string[]
  readonly turns: readonly Turn[]
  /** 全量链条计数，不受 500 条上限影响 */
  readonly chainCounts: ChainCounts
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly parseErrorCount: number
}

export interface TimelinePayload {
  readonly granularity: 'hour' | 'day'
  readonly buckets: readonly TimeBucket[]
}

export interface ScanJob {
  readonly jobId: string
  readonly status: 'queued' | 'running' | 'done' | 'failed'
  readonly totalFiles: number
  readonly processedFiles: number
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly error: string | null
}

/** 查询参数（已通过 zod 校验后的形态） */
/**
 * 会话列表查询。
 *
 * page / limit / sort / order 是**可选**的：仓储层会补默认值（见
 * queries.ts 的 normalizeSessionsQuery）。HTTP 层有 zod 兜底所以总是传全，
 * 但仓储是公开 API，CLI 与测试都可能漏传——TS 的可选标记只在编译期有效，
 * 类型上标成必填会让人以为"不传就一定没问题"，而运行时照样能传空对象。
 */
export interface SessionsQuery {
  /** Literal substring of indexed previews (200 chars/turn), ID, project, path or branch. */
  readonly search?: string
  readonly page?: number
  readonly limit?: number
  readonly project?: string
  readonly model?: string
  readonly sort?: 'cost' | 'tokens' | 'recent' | 'turns'
  readonly order?: 'asc' | 'desc'
}

export interface TimelineQuery {
  readonly granularity: 'hour' | 'day'
  readonly since?: string
  readonly until?: string
  readonly project?: string
}

export interface ScanRequest {
  readonly rootDir?: string
  readonly projectSlugs?: readonly string[]
  readonly since?: string
  readonly force?: boolean
}

/** Overview uses the same aggregation contract as the engine. */
export type OverviewPayload = AggregatedStats
