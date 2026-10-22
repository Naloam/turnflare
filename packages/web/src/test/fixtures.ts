import type {
  CostBreakdown,
  ModelStats,
  OverviewPayload,
  ProjectStats,
  SessionDetail,
  SessionListItem,
  SidechainSummary,
  TimeBucket,
  TokenUsage,
  ToolInvocation,
  Turn,
} from '../types/api'

/**
 * 测试夹具工厂。
 *
 * 全部走 `Partial<T>` + 展开：每个工厂给出合法默认值，测试只覆盖自己关心的字段，
 * 避免每个用例都手写一长串必填字段（也避免契约加字段时全军覆没）。
 */

export function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    speed: 'standard',
    inputTokens: 1200,
    cacheCreationTokens: 300,
    cacheReadTokens: 400,
    outputTokens: 250,
    thinkingTokens: 100,
    serverToolUse: 0,
    ...overrides,
  }
}

export function makeCost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    inputCost: 0.006,
    outputCost: 0.003,
    cacheWriteCost: 0.001,
    cacheReadCost: 0.0004,
    totalCost: 0.0104,
    currency: 'USD',
    unpricedModel: false,
    isEstimated: false,
    ...overrides,
  }
}

export function makeTool(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    toolName: 'Read',
    toolUseId: 'tool-1',
    isError: false,
    resultBytes: 2048,
    ...overrides,
  }
}

export function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'turn-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:25:26.923Z',
    model: 'claude-sonnet-4-5-20250929',
    usage: makeUsage(),
    tools: [],
    textPreview: '一段文本预览',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

export function makeSessionListItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: 'session-1',
    projectSlug: 'demo-project',
    cwd: '/tmp/demo',
    gitBranch: 'main',
    startedAt: '2026-10-19T08:00:00.000Z',
    endedAt: '2026-10-19T09:00:00.000Z',
    models: ['claude-sonnet-4-5-20250929'],
    turnCount: 12,
    usage: makeUsage(),
    cost: makeCost(),
    ...overrides,
  }
}

export function makeTimeBucket(overrides: Partial<TimeBucket> = {}): TimeBucket {
  return {
    bucket: '2026-10-19T00:00:00Z',
    usage: makeUsage(),
    cost: makeCost(),
    requestCount: 4,
    ...overrides,
  }
}

export function makeModelStats(overrides: Partial<ModelStats> = {}): ModelStats {
  return {
    model: 'claude-sonnet-4-5-20250929',
    requestCount: 10,
    usage: makeUsage(),
    cost: makeCost({ totalCost: 2.5 }),
    ...overrides,
  }
}

export function makeProjectStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
  return {
    projectSlug: 'demo-project',
    sessionCount: 3,
    usage: makeUsage(),
    cost: makeCost({ totalCost: 4.5 }),
    ...overrides,
  }
}

/**
 * 侧链汇总夹具。
 *
 * 默认值按"有侧链活动"给：turnCount 为 0 是另一套语义（没有侧链，提示条不该
 * 出现），需要那种情形时显式传 `turnCount: 0`，避免默认值把两种情况混在一起。
 */
export function makeSidechain(overrides: Partial<SidechainSummary> = {}): SidechainSummary {
  return {
    turnCount: 24,
    usage: makeUsage({ outputTokens: 250 }),
    cost: makeCost({ totalCost: 0 }),
    requestCount: 18,
    ...overrides,
  }
}

export function makeOverview(overrides: Partial<OverviewPayload> = {}): OverviewPayload {
  return {
    sessionCount: 3,
    turnCount: 42,
    usage: makeUsage(),
    cost: makeCost({ totalCost: 12.5 }),
    sidechain: makeSidechain(),
    byModel: [makeModelStats()],
    byProject: [makeProjectStats()],
    byHour: [makeTimeBucket()],
    byDay: [makeTimeBucket()],
    toolUsage: [],
    cacheHitRate: 0.42,
    errorRate: 0.01,
    firstActivityAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: '2026-10-19T09:00:00.000Z',
    ...overrides,
  }
}

export function makeSessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  const turns = overrides.turns ?? []
  const side = turns.filter((turn) => turn.isSidechain).length
  return {
    sessionId: 'session-1',
    projectSlug: 'demo-project',
    cwd: '/tmp/demo',
    gitBranch: 'main',
    startedAt: '2026-10-19T08:00:00.000Z',
    endedAt: '2026-10-19T09:00:00.000Z',
    models: ['claude-sonnet-4-5-20250929'],
    turns: [makeTurn()],
    usage: makeUsage(),
    cost: makeCost(),
    parseErrorCount: 0,
    // 默认按 turns 推导，与真实服务端一致；overrides 展开会覆盖它
    chainCounts: { total: turns.length, main: turns.length - side, side },
    ...overrides,
  }
}

/** 把任意数据包进统一响应包络 */
export function envelope<T>(data: T): { success: boolean; data: T; error: null } {
  return { success: true, data, error: null }
}

/** 失败包络 */
export function failureEnvelope(error: string): {
  success: boolean
  data: null
  error: string
} {
  return { success: false, data: null, error }
}
