import type {
  CostBreakdown,
  ModelStats,
  ProjectStats,
  TimeBucket,
  TokenUsage,
  ToolStats,
} from './domain.js'
import type { SessionChain } from './http.js'

/** Turn timestamp bounds are UTC: since inclusive, until exclusive. Default chain: main. */
export interface UsageQuery {
  readonly since?: string
  readonly until?: string
  readonly project?: string
  readonly model?: string
  readonly chain?: SessionChain
}

/** Every dimension describes the same selected turns. Session counts exclude empty sessions. */
export interface AnalyticsPayload {
  readonly filters: UsageQuery
  readonly sessionCount: number
  readonly turnCount: number
  readonly requestCount: number
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly models: readonly ModelStats[]
  readonly projects: readonly ProjectStats[]
  readonly days: readonly TimeBucket[]
  readonly tools: readonly ToolStats[]
  readonly cacheHitRate: number
  readonly errorRate: number
  readonly firstActivityAt: string | null
  readonly lastActivityAt: string | null
}

/** Cheap selector lists, independent of the selected analytics cohort. */
export interface AnalyticsOptions {
  readonly projects: readonly string[]
  readonly models: readonly string[]
}
