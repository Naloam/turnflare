import { describe, expect, it } from 'vitest'
import { aggregate } from './aggregate'
import type {
  AggregatedStats,
  Session,
  SessionMeta,
  TokenUsage,
  ToolInvocation,
  Turn,
} from '../types'
import type { CostCalculator } from './types'

function createUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    speed: 'standard',
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    serverToolUse: 0,
    ...overrides,
  }
}

function createTool(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    toolName: 'Bash',
    toolUseId: 'tool-1',
    isError: false,
    resultBytes: 0,
    ...overrides,
  }
}

function createTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'uuid-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:00:00.000Z',
    model: 'claude-opus-5-5',
    usage: null,
    tools: [],
    textPreview: '',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

function createMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: 'session-1',
    filePath: '/tmp/session-1.jsonl',
    projectSlug: '-Users-che1sy-Projects-foo',
    cwd: null,
    gitBranch: null,
    cliVersion: null,
    startedAt: null,
    endedAt: null,
    models: [],
    ...overrides,
  }
}

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    meta: createMeta(),
    turns: [],
    records: [],
    parseErrors: [],
    ...overrides,
  }
}

/** 见 usage.test.ts：把"运行时不遵守契约"的值塞进强类型签名 */
function withRuntimeValue<T>(value: unknown): T {
  return value as T
}

/** 每百万输入 token 两美元，用来验证成本汇总与排序 */
const TWO_DOLLARS_PER_MILLION: CostCalculator = (usage) => {
  const inputCost = (usage.inputTokens / 1_000_000) * 2
  return {
    inputCost,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: inputCost,
    currency: 'USD',
    unpricedModel: false,
    isEstimated: false,
  }
}

const OPUS_TURN = createTurn({
  uuid: 't1',
  model: 'claude-opus-5-5',
  timestamp: '2026-10-19T08:00:00.000Z',
  usage: createUsage({ inputTokens: 1000, cacheReadTokens: 3000, outputTokens: 500 }),
  tools: [
    createTool({ toolName: 'Bash', toolUseId: 'u1', isError: true, resultBytes: 100 }),
    createTool({ toolName: 'Read', toolUseId: 'u2', resultBytes: 50 }),
  ],
})

const SONNET_TURN = createTurn({
  uuid: 't2',
  model: 'claude-sonnet-5-5',
  timestamp: '2026-10-19T09:00:00.000Z',
  usage: createUsage({ inputTokens: 2000, outputTokens: 100 }),
  tools: [createTool({ toolName: 'Bash', toolUseId: 'u3', resultBytes: 20 })],
})

const NEXT_DAY_TURN = createTurn({
  uuid: 't3',
  timestamp: '2026-10-20T10:00:00.000Z',
  usage: createUsage({ inputTokens: 500, outputTokens: 50 }),
})

const FOO_SESSION = createSession({
  meta: createMeta({ sessionId: 'session-foo', filePath: '/tmp/foo.jsonl' }),
  turns: [OPUS_TURN, SONNET_TURN],
})

const BAR_SESSION = createSession({
  meta: createMeta({
    sessionId: 'session-bar',
    filePath: '/tmp/bar.jsonl',
    projectSlug: '-Users-che1sy-Projects-bar',
  }),
  turns: [NEXT_DAY_TURN],
})

function expectZeroedStats(stats: AggregatedStats): void {
  expect(stats.sessionCount).toBe(0)
  expect(stats.turnCount).toBe(0)
  expect(stats.usage).toEqual(createUsage())
  expect(stats.cost.totalCost).toBe(0)
  expect(stats.byModel).toEqual([])
  expect(stats.byProject).toEqual([])
  expect(stats.byHour).toEqual([])
  expect(stats.byDay).toEqual([])
  expect(stats.toolUsage).toEqual([])
  expect(stats.cacheHitRate).toBe(0)
  expect(stats.errorRate).toBe(0)
  expect(stats.firstActivityAt).toBeNull()
  expect(stats.lastActivityAt).toBeNull()
  expect(stats.sidechain.turnCount).toBe(0)
  expect(stats.sidechain.requestCount).toBe(0)
  expect(stats.sidechain.usage).toEqual(createUsage())
  expect(stats.sidechain.cost.totalCost).toBe(0)
}

describe('aggregate', () => {
  it('returns a fully zeroed result for empty input instead of throwing', () => {
    // Act
    const stats = aggregate([])

    // Assert
    expectZeroedStats(stats)
  })

  it('counts sessions and turns after deduplication', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION])

    // Assert
    expect(stats.sessionCount).toBe(2)
    expect(stats.turnCount).toBe(3)
  })

  it('sums usage across every turn', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION])

    // Assert
    expect(stats.usage).toEqual(
      createUsage({ inputTokens: 3500, cacheReadTokens: 3000, outputTokens: 650 }),
    )
  })

  it('derives the cache hit rate from the summed usage', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION])

    // Assert：3000 缓存读 / (3500 直连输入 + 3000 缓存读)
    expect(stats.cacheHitRate).toBeCloseTo(3000 / 6500, 10)
  })

  it('reports the raw timestamps of the first and last activity', () => {
    // Act
    const stats = aggregate([BAR_SESSION, FOO_SESSION])

    // Assert
    expect(stats.firstActivityAt).toBe('2026-10-19T08:00:00.000Z')
    expect(stats.lastActivityAt).toBe('2026-10-20T10:00:00.000Z')
  })

  it('aggregates tool calls and the tool error rate', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION])

    // Assert
    expect(stats.toolUsage).toEqual([
      { toolName: 'Bash', callCount: 2, errorCount: 1, totalResultBytes: 120 },
      { toolName: 'Read', callCount: 1, errorCount: 0, totalResultBytes: 50 },
    ])
    expect(stats.errorRate).toBeCloseTo(1 / 3, 10)
  })

  it('builds hour and day buckets', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION])

    // Assert
    expect(stats.byHour.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-19T08:00:00Z',
      '2026-10-19T09:00:00Z',
      '2026-10-20T10:00:00Z',
    ])
    expect(stats.byDay.map((bucket) => bucket.bucket)).toEqual(['2026-10-19', '2026-10-20'])
    expect(stats.byDay[0]?.requestCount).toBe(2)
  })

  it('drops repeated turns that share a uuid', () => {
    // Arrange：compaction 会让同一条消息出现在另一条记录里
    const sessions = [
      FOO_SESSION,
      createSession({ meta: createMeta({ filePath: '/tmp/dup.jsonl' }), turns: [OPUS_TURN] }),
    ]

    // Act
    const stats = aggregate(sessions)

    // Assert
    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(3000)
  })

  it('counts a session once when the same file is scanned twice', () => {
    // Act
    const stats = aggregate([FOO_SESSION, FOO_SESSION])

    // Assert
    expect(stats.sessionCount).toBe(1)
    expect(stats.turnCount).toBe(2)
  })

  it('keeps sessions apart when only the session id is shared', () => {
    // Arrange：同一个 sessionId 落在两个文件里，仍然是两场会话
    const sessions = [
      FOO_SESSION,
      createSession({
        meta: createMeta({ filePath: '/tmp/other.jsonl' }),
        turns: [NEXT_DAY_TURN],
      }),
    ]

    // Act
    const stats = aggregate(sessions)

    // Assert
    expect(stats.sessionCount).toBe(2)
    expect(stats.turnCount).toBe(3)
  })

  it('falls back to the session id when the file path is empty', () => {
    // Arrange：没有 filePath 时按 sessionId 认定同一场会话
    const sessions = [
      createSession({
        meta: createMeta({ filePath: '', sessionId: 'session-a' }),
        turns: [OPUS_TURN],
      }),
      createSession({
        meta: createMeta({ filePath: '', sessionId: 'session-a' }),
        turns: [SONNET_TURN],
      }),
      createSession({
        meta: createMeta({ filePath: '', sessionId: 'session-b' }),
        turns: [NEXT_DAY_TURN],
      }),
    ]

    // Act
    const stats = aggregate(sessions)

    // Assert
    expect(stats.sessionCount).toBe(2)
    expect(stats.turnCount).toBe(2)
  })

  it('keeps sessions apart when neither the file path nor the session id identifies them', () => {
    // Arrange：两者都缺时按输入序号区分，绝不把两场会话合并成一场
    const sessions = [
      createSession({ meta: createMeta({ filePath: '', sessionId: '' }), turns: [OPUS_TURN] }),
      createSession({ meta: createMeta({ filePath: '', sessionId: '' }), turns: [SONNET_TURN] }),
    ]

    // Act
    const stats = aggregate(sessions)

    // Assert
    expect(stats.sessionCount).toBe(2)
  })
})

describe('aggregate sidechain handling', () => {
  const sidechainTurn = createTurn({
    uuid: 's1',
    isSidechain: true,
    usage: createUsage({ inputTokens: 999 }),
  })

  it('excludes sidechain turns by default', () => {
    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN, sidechainTurn] })])

    // Assert
    expect(stats.turnCount).toBe(1)
    expect(stats.usage.inputTokens).toBe(1000)
  })

  it('includes sidechain turns when asked to', () => {
    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN, sidechainTurn] })], {
      includeSidechain: true,
    })

    // Assert
    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(1999)
  })

  it('does not count a session whose only turn is an excluded sidechain', () => {
    // Act
    const stats = aggregate([createSession({ turns: [sidechainTurn] })])

    // Assert
    expect(stats.sessionCount).toBe(0)
    expect(stats.turnCount).toBe(0)
  })

  it('reports sidechain usage beside the main-chain numbers without merging them', () => {
    // Arrange：一条主链 + 一条侧链，两条都计费
    const mainTurn = createTurn({ uuid: 'main', usage: createUsage({ inputTokens: 1000 }) })
    const subTurn = createTurn({
      uuid: 'sub',
      isSidechain: true,
      model: 'claude-sonnet-5-5',
      usage: createUsage({ inputTokens: 999, outputTokens: 50 }),
    })

    // Act
    const stats = aggregate([createSession({ turns: [mainTurn, subTurn] })], {
      costCalculator: TWO_DOLLARS_PER_MILLION,
    })

    // Assert：主链字段保持"只算主链"的旧口径，侧链模型不混进 byModel
    expect(stats.turnCount).toBe(1)
    expect(stats.usage.inputTokens).toBe(1000)
    expect(stats.byModel.map((entry) => entry.model)).toEqual(['claude-opus-5-5'])
    // 侧链单独成一份，数字来自那条侧链 turn（价目表 $2/M × 999 输入）
    expect(stats.sidechain.turnCount).toBe(1)
    expect(stats.sidechain.requestCount).toBe(1)
    expect(stats.sidechain.usage.inputTokens).toBe(999)
    expect(stats.sidechain.cost.totalCost).toBeCloseTo((999 / 1_000_000) * 2, 12)
  })

  it('keeps unbilled sidechain turns out of the sidechain request count', () => {
    // Arrange：user 消息没有 usage，不计费也不算一次请求
    const stats = aggregate([
      createSession({
        turns: [
          createTurn({ uuid: 'sub-user', isSidechain: true, model: null, usage: null }),
          sidechainTurn,
        ],
      }),
    ])

    // Assert
    expect(stats.sidechain.turnCount).toBe(2)
    expect(stats.sidechain.requestCount).toBe(1)
  })

  it('zeroes the sidechain summary when there is no sidechain activity', () => {
    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN] })])

    // Assert
    expect(stats.sidechain.turnCount).toBe(0)
    expect(stats.sidechain.requestCount).toBe(0)
    expect(stats.sidechain.usage).toEqual(createUsage())
    expect(stats.sidechain.cost.totalCost).toBe(0)
  })
})

describe('aggregate time window', () => {
  it('keeps turns at or after since', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION], { since: '2026-10-19T09:00:00.000Z' })

    // Assert
    expect(stats.turnCount).toBe(2)
    expect(stats.firstActivityAt).toBe('2026-10-19T09:00:00.000Z')
  })

  it('drops turns at or after until because the upper bound is exclusive', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION], { until: '2026-10-19T09:00:00.000Z' })

    // Assert
    expect(stats.turnCount).toBe(1)
    expect(stats.lastActivityAt).toBe('2026-10-19T08:00:00.000Z')
  })

  it('combines since and until', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION], {
      since: '2026-10-19T08:00:00.000Z',
      until: '2026-10-20T00:00:00.000Z',
    })

    // Assert
    expect(stats.turnCount).toBe(2)
  })

  it('excludes turns without a parseable timestamp once a window is set', () => {
    // Arrange：没有时间戳就无法证明它落在窗口内
    const timeless = createTurn({
      uuid: 'x',
      timestamp: '',
      usage: createUsage({ inputTokens: 7 }),
    })

    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN, timeless] })], {
      since: '2026-10-01T00:00:00.000Z',
    })

    // Assert
    expect(stats.turnCount).toBe(1)
  })

  it('still counts timeless turns when no window is set', () => {
    // Arrange
    const timeless = createTurn({
      uuid: 'x',
      timestamp: '',
      usage: createUsage({ inputTokens: 7 }),
    })

    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN, timeless] })])

    // Assert
    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(1007)
    expect(stats.firstActivityAt).toBe('2026-10-19T08:00:00.000Z')
  })

  it('throws a readable error when since is not an ISO timestamp', () => {
    // Act
    const act = () => aggregate([FOO_SESSION], { since: 'yesterday' })

    // Assert
    expect(act).toThrow('聚合选项 since 不是合法的 ISO 时间字符串：yesterday')
  })

  it('throws a readable error when until is not an ISO timestamp', () => {
    // Act
    const act = () => aggregate([FOO_SESSION], { until: '2026-13-99' })

    // Assert
    expect(act).toThrow('聚合选项 until 不是合法的 ISO 时间字符串：2026-13-99')
  })
})

describe('aggregate by model', () => {
  it('groups turns by model and counts only turns that carry usage', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION], {}, TWO_DOLLARS_PER_MILLION)

    // Assert
    expect(stats.byModel.map((entry) => entry.model)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
    expect(stats.byModel[0]?.requestCount).toBe(1)
    expect(stats.byModel[1]?.requestCount).toBe(2)
    expect(stats.byModel[1]?.usage.inputTokens).toBe(1500)
    expect(stats.byModel[1]?.cost.totalCost).toBeCloseTo(0.003, 12)
  })

  it('sorts equal costs by model name so the order is reproducible', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'm1',
        model: 'claude-sonnet-5-5',
        usage: createUsage({ inputTokens: 1000 }),
      }),
      createTurn({
        uuid: 'm2',
        model: 'claude-opus-5-5',
        usage: createUsage({ inputTokens: 1000 }),
      }),
    ]

    // Act
    const stats = aggregate([createSession({ turns })], {}, TWO_DOLLARS_PER_MILLION)

    // Assert
    expect(stats.byModel.map((entry) => entry.model)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
  })

  it('keeps turns without a model in their own group so the parts still add up', () => {
    // Arrange
    const turns = [
      createTurn({ uuid: 'm1', model: null, usage: createUsage({ inputTokens: 1000 }) }),
      createTurn({
        uuid: 'm2',
        model: 'claude-opus-5-5',
        usage: createUsage({ inputTokens: 1000 }),
      }),
    ]

    // Act
    const stats = aggregate([createSession({ turns })])

    // Assert
    const summed = stats.byModel.reduce((total, entry) => total + entry.usage.inputTokens, 0)
    expect(summed).toBe(stats.usage.inputTokens)
    expect(stats.byModel.map((entry) => entry.model)).toEqual(['', 'claude-opus-5-5'])
  })

  it('does not create a model group for turns without usage', () => {
    // Arrange
    const turns = [createTurn({ uuid: 'm1', model: 'claude-opus-5-5', usage: null })]

    // Act
    const stats = aggregate([createSession({ turns })])

    // Assert
    expect(stats.byModel).toEqual([])
  })
})

describe('aggregate by project', () => {
  it('groups by project slug and counts the contributing sessions', () => {
    // Act
    const stats = aggregate([FOO_SESSION, BAR_SESSION], {}, TWO_DOLLARS_PER_MILLION)

    // Assert
    expect(stats.byProject.map((entry) => entry.projectSlug)).toEqual([
      '-Users-che1sy-Projects-foo',
      '-Users-che1sy-Projects-bar',
    ])
    expect(stats.byProject[0]?.sessionCount).toBe(1)
    expect(stats.byProject[0]?.usage.inputTokens).toBe(3000)
    expect(stats.byProject[0]?.cost.totalCost).toBeCloseTo(0.006, 12)
    expect(stats.byProject[1]?.sessionCount).toBe(1)
  })

  it('merges several sessions of the same project', () => {
    // Arrange
    const second = createSession({
      meta: createMeta({ sessionId: 'session-foo-2', filePath: '/tmp/foo-2.jsonl' }),
      turns: [NEXT_DAY_TURN],
    })

    // Act
    const stats = aggregate([FOO_SESSION, second], {}, TWO_DOLLARS_PER_MILLION)

    // Assert
    expect(stats.byProject).toHaveLength(1)
    expect(stats.byProject[0]?.sessionCount).toBe(2)
    expect(stats.byProject[0]?.usage.inputTokens).toBe(3500)
  })

  it('falls back to an empty slug when the session carries no meta', () => {
    // Arrange
    const session = withRuntimeValue<Session>({ ...FOO_SESSION, meta: undefined })

    // Act
    const stats = aggregate([session])

    // Assert
    expect(stats.byProject.map((entry) => entry.projectSlug)).toEqual([''])
    expect(stats.sessionCount).toBe(1)
  })

  it('attributes a turn to the session that first owned it', () => {
    // Arrange：调用方重新包装 meta 时会复用同一个 turn 对象，
    // 这条 turn 已经算过一遍，不能再进第二个项目
    const relabelled = createSession({
      meta: createMeta({
        sessionId: 'session-bar',
        filePath: '/tmp/bar.jsonl',
        projectSlug: '-Users-che1sy-Projects-bar',
      }),
      turns: [OPUS_TURN],
    })

    // Act
    const stats = aggregate([FOO_SESSION, relabelled], {}, TWO_DOLLARS_PER_MILLION)

    // Assert
    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(3000)
    expect(stats.sessionCount).toBe(1)
    expect(stats.byProject).toHaveLength(1)
    expect(stats.byProject[0]?.projectSlug).toBe('-Users-che1sy-Projects-foo')
    expect(stats.byProject[0]?.usage.inputTokens).toBe(3000)
  })
})

describe('aggregate cost assembly', () => {
  it('flags cost as unpriced when no calculator is assembled', () => {
    // Act
    const stats = aggregate([FOO_SESSION])

    // Assert
    // 没有计算器就等于无法定价。静默报 0 会让使用者以为这些 token 不要钱，
    // 比明确说"算不出来"更糟，因此 unpricedModel 必须为 true。
    expect(stats.cost).toEqual({
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
      currency: 'USD',
      unpricedModel: true,
      isEstimated: false,
    })
  })

  it('uses the calculator passed through the options', () => {
    // Act
    const stats = aggregate([FOO_SESSION], { costCalculator: TWO_DOLLARS_PER_MILLION })

    // Assert
    expect(stats.cost.totalCost).toBeCloseTo(0.006, 12)
    expect(stats.byHour[0]?.cost.totalCost).toBeCloseTo(0.002, 12)
  })

  it('prefers the positional calculator over the one in the options', () => {
    // Arrange：位置参数每次调用计 1 美元，两条 turn 合计 2 美元
    const options = { costCalculator: TWO_DOLLARS_PER_MILLION }
    const positional: CostCalculator = () => ({
      inputCost: 1,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 1,
      currency: 'USD',
      unpricedModel: true,
      isEstimated: false,
    })

    // Act
    const stats = aggregate([FOO_SESSION], options, positional)

    // Assert
    expect(stats.cost.inputCost).toBe(2)
    expect(stats.cost.unpricedModel).toBe(true)
  })

  it('keeps aggregating when the calculator throws', () => {
    // Arrange
    const calculator: CostCalculator = () => {
      throw new Error('价目表损坏')
    }

    // Act
    const stats = aggregate([FOO_SESSION], {}, calculator)

    // Assert
    expect(stats.cost.totalCost).toBe(0)
    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(3000)
  })

  it('propagates the pricing markers from the calculator', () => {
    // Arrange
    const calculator: CostCalculator = () => ({
      inputCost: 1,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 1,
      currency: 'USD',
      unpricedModel: true,
      isEstimated: true,
    })

    // Act
    const stats = aggregate([FOO_SESSION], {}, calculator)

    // Assert
    expect(stats.cost.unpricedModel).toBe(true)
    expect(stats.cost.isEstimated).toBe(true)
  })
})

describe('aggregate timezone', () => {
  it('shifts hour and day buckets by the timezone offset', () => {
    // Act
    const stats = aggregate([FOO_SESSION], { timezoneOffsetMinutes: 480 })

    // Assert
    expect(stats.byHour.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-19T16:00:00Z',
      '2026-10-19T17:00:00Z',
    ])
    expect(stats.byDay.map((bucket) => bucket.bucket)).toEqual(['2026-10-19'])
  })

  it('treats a non-numeric offset as UTC', () => {
    // Act
    const stats = aggregate([FOO_SESSION], {
      timezoneOffsetMinutes: withRuntimeValue<number>('480'),
    })

    // Assert
    expect(stats.byHour[0]?.bucket).toBe('2026-10-19T08:00:00Z')
  })
})

describe('aggregate malformed input', () => {
  it('skips sessions whose turns are not an array', () => {
    // Arrange
    const session = withRuntimeValue<Session>({ ...FOO_SESSION, turns: 'not-an-array' })

    // Act
    const stats = aggregate([session, BAR_SESSION])

    // Assert
    expect(stats.sessionCount).toBe(1)
    expect(stats.turnCount).toBe(1)
  })

  it('drops malformed turn entries instead of throwing', () => {
    // Arrange
    const malformed = withRuntimeValue<Turn>(null)
    const notAnObject = withRuntimeValue<Turn>('turn')

    // Act
    const stats = aggregate([createSession({ turns: [OPUS_TURN, malformed, notAnObject] })])

    // Assert
    expect(stats.turnCount).toBe(1)
    expect(stats.usage.inputTokens).toBe(1000)
  })

  it('ignores sessions that are not objects', () => {
    // Arrange
    const malformed = withRuntimeValue<Session>(null)

    // Act
    const stats = aggregate([malformed, BAR_SESSION])

    // Assert
    expect(stats.sessionCount).toBe(1)
  })

  it('ignores dirty usage fields when summing', () => {
    // Arrange
    const dirty = withRuntimeValue<Turn>({
      ...OPUS_TURN,
      usage: { ...createUsage({ inputTokens: 1000 }), inputTokens: Number.NaN },
    })

    // Act
    const stats = aggregate([createSession({ turns: [dirty] })])

    // Assert
    expect(stats.usage.inputTokens).toBe(0)
    expect(Number.isNaN(stats.cost.totalCost)).toBe(false)
  })

  it('returns a zeroed result when every session is empty', () => {
    // Act
    const stats = aggregate([createSession(), createSession()])

    // Assert
    expectZeroedStats(stats)
  })
})
