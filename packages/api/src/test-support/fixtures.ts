/**
 * 测试夹具：领域对象的建造器。
 *
 * 只给"默认值合理 + 可按字段覆盖"的最小实现，让每个测试只写自己关心的差异。
 * 这些对象全部只读——夹具也不该成为可变状态的源头。
 */

import type {
  AggregatedStats,
  CostBreakdown,
  ModelStats,
  ProjectStats,
  SessionDetail,
  SidechainSummary,
  TimeBucket,
  TokenUsage,
  ToolStats,
  Turn,
  ChainCounts,
} from '../types.js'

const BASE_TIMESTAMP = '2026-10-19T08:00:00.000Z'

export function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    speed: 'standard',
    inputTokens: 1000,
    cacheCreationTokens: 100,
    cacheReadTokens: 5000,
    outputTokens: 200,
    thinkingTokens: 20,
    serverToolUse: 0,
    ...overrides,
  }
}

export function makeCost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    inputCost: 0.5,
    outputCost: 0.25,
    cacheWriteCost: 0.1,
    cacheReadCost: 0.05,
    totalCost: 0.9,
    currency: 'USD',
    unpricedModel: false,
    isEstimated: false,
    ...overrides,
  }
}

export interface SessionDetailOverrides {
  readonly sessionId?: string
  readonly projectSlug?: string
  readonly cwd?: string | null
  readonly gitBranch?: string | null
  readonly startedAt?: string | null
  readonly endedAt?: string | null
  readonly models?: readonly string[]
  readonly usage?: TokenUsage
  readonly cost?: CostBreakdown
  readonly turns?: readonly Turn[]
  readonly parseErrorCount?: number
  readonly chainCounts?: ChainCounts
}

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'turn-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: BASE_TIMESTAMP,
    model: 'claude-opus-5-5',
    usage: makeUsage(),
    tools: [],
    textPreview: '预览文本',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

/** 造 n 条轮次；lineNumber 递增，便于断言顺序 */
export function makeTurns(count: number): readonly Turn[] {
  return Array.from({ length: count }, (_, index) =>
    makeTurn({ uuid: `turn-${index}`, lineNumber: index + 1 }),
  )
}

export function makeSessionDetail(overrides: SessionDetailOverrides = {}): SessionDetail {
  return {
    sessionId: overrides.sessionId ?? '11111111-2222-4333-8444-555555555555',
    projectSlug: overrides.projectSlug ?? '-Users-che1sy-Projects-alpha',
    cwd: overrides.cwd === undefined ? '/Users/che1sy/Projects/alpha' : overrides.cwd,
    gitBranch: overrides.gitBranch === undefined ? 'main' : overrides.gitBranch,
    startedAt: overrides.startedAt === undefined ? BASE_TIMESTAMP : overrides.startedAt,
    endedAt: overrides.endedAt === undefined ? '2026-10-19T09:00:00.000Z' : overrides.endedAt,
    models: overrides.models ?? ['claude-opus-5-5'],
    usage: overrides.usage ?? makeUsage(),
    cost: overrides.cost ?? makeCost(),
    turns: overrides.turns ?? [],
    // 默认按 turns 推导，与真实服务端行为一致；调用方可用 overrides 覆盖
    chainCounts: overrides.chainCounts ?? deriveChainCounts(overrides.turns ?? []),
    parseErrorCount: overrides.parseErrorCount ?? 0,
  }
}

/** 从 turns 推导链条计数，供夹具默认值使用 */
function deriveChainCounts(turns: readonly { isSidechain: boolean }[]) {
  const side = turns.filter((turn) => turn.isSidechain).length
  return { total: turns.length, main: turns.length - side, side }
}

/**
 * 造一批会话：成本递减、轮次递增。
 *
 * 于是默认排序（cost 降序）恰好等于创建顺序，而 turns 升序也等于创建顺序，
 * 两个方向的断言都不用重排期望值。
 */
export function makeSessionSeries(count: number): readonly SessionDetail[] {
  return Array.from({ length: count }, (_, index) =>
    makeSessionDetail({
      sessionId: `${String(index).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`,
      turns: makeTurns(index + 1),
      cost: makeCost({ totalCost: (count - index) * 0.5 }),
    }),
  )
}

export function makeModelStats(overrides: Partial<ModelStats> = {}): ModelStats {
  return {
    model: 'claude-opus-5-5',
    requestCount: 120,
    usage: makeUsage(),
    cost: makeCost(),
    ...overrides,
  }
}

export function makeProjectStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
  return {
    projectSlug: '-Users-che1sy-Projects-alpha',
    sessionCount: 4,
    usage: makeUsage(),
    cost: makeCost(),
    ...overrides,
  }
}

export function makeToolStats(overrides: Partial<ToolStats> = {}): ToolStats {
  return {
    toolName: 'Read',
    callCount: 42,
    errorCount: 2,
    totalResultBytes: 128000,
    ...overrides,
  }
}

export function makeTimeBucket(overrides: Partial<TimeBucket> = {}): TimeBucket {
  return {
    bucket: '2026-10-19',
    usage: makeUsage(),
    cost: makeCost(),
    requestCount: 30,
    ...overrides,
  }
}

/**
 * 造一份侧链汇总。
 *
 * 默认值刻意与主链不同（成本 0、turn 少）：大多数测试只关心主链字段，
 * 侧链给一个显眼的非默认值反而会在断言里造成噪音。
 */
export function makeSidechainSummary(overrides: Partial<SidechainSummary> = {}): SidechainSummary {
  return {
    turnCount: 12,
    usage: makeUsage({ inputTokens: 700, outputTokens: 90 }),
    cost: makeCost({ totalCost: 0.31 }),
    requestCount: 9,
    ...overrides,
  }
}

export function makeAggregatedStats(overrides: Partial<AggregatedStats> = {}): AggregatedStats {
  const usage = makeUsage()
  return {
    sessionCount: 3,
    turnCount: 120,
    usage,
    cost: makeCost(),
    byModel: [makeModelStats()],
    byProject: [makeProjectStats()],
    byHour: [makeTimeBucket({ bucket: '2026-10-19T08:00:00Z' })],
    byDay: [makeTimeBucket()],
    toolUsage: [makeToolStats()],
    cacheHitRate: 0.948,
    errorRate: 0.021,
    firstActivityAt: '2026-09-01T02:11:00.000Z',
    lastActivityAt: '2026-10-19T10:08:04.883Z',
    sidechain: makeSidechainSummary(),
    ...overrides,
  }
}
