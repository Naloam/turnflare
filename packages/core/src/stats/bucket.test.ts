import { describe, expect, it } from 'vitest'
import { bucketByDay, bucketByHour, parseTimestamp } from './bucket'
import type { CostBreakdown, TokenUsage, Turn } from '../types'
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

function createTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    uuid: 'uuid-1',
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:25:26.923Z',
    model: 'claude-opus-5-5',
    usage: null,
    tools: [],
    textPreview: '',
    isSidechain: false,
    lineNumber: 1,
    ...overrides,
  }
}

/** 见 usage.test.ts：把"运行时不遵守契约"的值塞进强类型签名 */
function withRuntimeValue<T>(value: unknown): T {
  return value as T
}

/** 每百万输入 token 一美元，用来验证成本确实按桶汇总 */
const DOLLAR_PER_MILLION: CostCalculator = (usage) => ({
  inputCost: usage.inputTokens / 1_000_000,
  outputCost: 0,
  cacheWriteCost: 0,
  cacheReadCost: 0,
  totalCost: usage.inputTokens / 1_000_000,
  currency: 'USD',
  unpricedModel: false,
  isEstimated: false,
})

const MORNING_TURN = createTurn({
  uuid: 'a',
  timestamp: '2026-10-19T08:25:26.923Z',
  usage: createUsage({ inputTokens: 100, outputTokens: 50 }),
})

const LATE_MORNING_TURN = createTurn({
  uuid: 'b',
  timestamp: '2026-10-19T08:59:00.000Z',
  usage: createUsage({ inputTokens: 200 }),
})

const NEXT_HOUR_TURN = createTurn({
  uuid: 'c',
  timestamp: '2026-10-19T09:05:00.000Z',
  usage: createUsage({ inputTokens: 10 }),
})

describe('parseTimestamp', () => {
  it('parses a UTC ISO string into epoch milliseconds', () => {
    // Act
    const ms = parseTimestamp('2026-10-19T08:00:00.000Z')

    // Assert
    expect(ms).toBe(Date.UTC(2026, 9, 19, 8, 0, 0))
  })

  it('returns null for empty, non-string and unparseable values', () => {
    // Act / Assert
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('not-a-date')).toBeNull()
    expect(parseTimestamp(1760000000000)).toBeNull()
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
  })
})

describe('bucketByHour', () => {
  it('groups turns into hour buckets aligned to the hour', () => {
    // Act
    const buckets = bucketByHour([MORNING_TURN, LATE_MORNING_TURN, NEXT_HOUR_TURN])

    // Assert
    expect(buckets.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-19T08:00:00Z',
      '2026-10-19T09:00:00Z',
    ])
    expect(buckets[0]?.requestCount).toBe(2)
    expect(buckets[0]?.usage).toEqual(createUsage({ inputTokens: 300, outputTokens: 50 }))
    expect(buckets[1]?.requestCount).toBe(1)
    expect(buckets[1]?.usage.inputTokens).toBe(10)
  })

  it('sorts buckets ascending by time', () => {
    // Arrange：乱序输入 + 跨天，字典序必须等于时间序
    const turns = [
      NEXT_HOUR_TURN,
      createTurn({
        uuid: 'd',
        timestamp: '2026-10-20T01:00:00.000Z',
        usage: createUsage({ inputTokens: 1 }),
      }),
      MORNING_TURN,
      createTurn({
        uuid: 'e',
        timestamp: '2026-10-18T23:00:00.000Z',
        usage: createUsage({ inputTokens: 2 }),
      }),
    ]

    // Act
    const buckets = bucketByHour(turns)

    // Assert
    expect(buckets.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-18T23:00:00Z',
      '2026-10-19T08:00:00Z',
      '2026-10-19T09:00:00Z',
      '2026-10-20T01:00:00Z',
    ])
  })

  it('skips turns without usage', () => {
    // Arrange：没有 usage 的 turn 不产生计费，也不该挤进任何桶
    const noUsage = createTurn({ uuid: 'x', usage: null })

    // Act
    const buckets = bucketByHour([MORNING_TURN, noUsage])

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.requestCount).toBe(1)
  })

  it('skips turns whose timestamp cannot be parsed', () => {
    // Arrange
    const broken = createTurn({ uuid: 'y', timestamp: '', usage: createUsage({ inputTokens: 5 }) })
    const notAString = withRuntimeValue<Turn>({ ...MORNING_TURN, timestamp: 1760000000000 })

    // Act
    const buckets = bucketByHour([MORNING_TURN, broken, notAString])

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.usage.inputTokens).toBe(100)
  })

  it('returns an empty array for empty input', () => {
    // Act / Assert
    expect(bucketByHour([])).toEqual([])
  })

  it('shifts buckets by the timezone offset', () => {
    // Act：UTC+8 的 08:25 是当地下午 16:25
    const east = bucketByHour([MORNING_TURN], 480)
    const west = bucketByHour([MORNING_TURN], -300)

    // Assert
    expect(east[0]?.bucket).toBe('2026-10-19T16:00:00Z')
    expect(west[0]?.bucket).toBe('2026-10-19T03:00:00Z')
  })

  it('defaults to UTC when the offset is missing or not a number', () => {
    // Act
    const withoutOffset = bucketByHour([MORNING_TURN])
    const dirtyOffset = bucketByHour([MORNING_TURN], withRuntimeValue<number>('480'))

    // Assert
    expect(withoutOffset[0]?.bucket).toBe('2026-10-19T08:00:00Z')
    expect(dirtyOffset[0]?.bucket).toBe('2026-10-19T08:00:00Z')
  })

  it('clamps an absurd timezone offset instead of producing an invalid date', () => {
    // Act：1e9 分钟的偏移会把日期平移到公元 275760 年
    const buckets = bucketByHour([MORNING_TURN], 1_000_000_000)

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.bucket).toBe('2026-10-19T22:00:00Z')
  })

  it('sums the cost of every turn in the bucket', () => {
    // Act
    const buckets = bucketByHour([MORNING_TURN, LATE_MORNING_TURN], 0, DOLLAR_PER_MILLION)

    // Assert
    expect(buckets[0]?.cost.inputCost).toBeCloseTo(0.0003, 12)
    expect(buckets[0]?.cost.totalCost).toBeCloseTo(0.0003, 12)
    expect(buckets[0]?.cost.currency).toBe('USD')
  })

  it('reports zero money but an unpriced model when no calculator is assembled', () => {
    // Act
    const buckets = bucketByHour([MORNING_TURN])

    // Assert
    expect(buckets[0]?.cost).toEqual({
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

  it('does not mutate the input array', () => {
    // Arrange
    const turns = [MORNING_TURN, NEXT_HOUR_TURN]

    // Act
    bucketByHour(turns)

    // Assert
    expect(turns).toHaveLength(2)
    expect(turns[0]).toBe(MORNING_TURN)
  })

  it('skips turns whose timestamp leaves the representable date range', () => {
    // Arrange：可表示的最大时刻再往东偏移 14 小时就超出 Date 的范围
    const edge = createTurn({
      uuid: 'k',
      timestamp: '+275760-09-13T00:00:00.000Z',
      usage: createUsage({ inputTokens: 1 }),
    })

    // Act
    const buckets = bucketByHour([MORNING_TURN, edge], 840)

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.bucket).toBe('2026-10-19T22:00:00Z')
  })
})

describe('bucketByDay', () => {
  it('groups turns by local date', () => {
    // Act
    const buckets = bucketByDay([MORNING_TURN, NEXT_HOUR_TURN])

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.bucket).toBe('2026-10-19')
    expect(buckets[0]?.requestCount).toBe(2)
    expect(buckets[0]?.usage.inputTokens).toBe(110)
  })

  it('moves a late evening turn into the next local day', () => {
    // Arrange：UTC 20:30 在东八区已经是次日凌晨
    const evening = createTurn({
      uuid: 'e',
      timestamp: '2026-10-19T20:30:00.000Z',
      usage: createUsage({ inputTokens: 1 }),
    })

    // Act
    const buckets = bucketByDay([evening], 480)

    // Assert
    expect(buckets[0]?.bucket).toBe('2026-10-20')
  })

  it('moves an early morning turn into the previous local day', () => {
    // Arrange：UTC 02:30 在 UTC-5 还是前一天晚上
    const earlyMorning = createTurn({
      uuid: 'f',
      timestamp: '2026-10-19T02:30:00.000Z',
      usage: createUsage({ inputTokens: 1 }),
    })

    // Act
    const buckets = bucketByDay([earlyMorning], -300)

    // Assert
    expect(buckets[0]?.bucket).toBe('2026-10-18')
  })

  it('sorts day buckets ascending', () => {
    // Arrange
    const turns = [
      createTurn({
        uuid: 'g',
        timestamp: '2026-10-21T00:00:00.000Z',
        usage: createUsage({ inputTokens: 1 }),
      }),
      createTurn({
        uuid: 'h',
        timestamp: '2026-10-19T23:00:00.000Z',
        usage: createUsage({ inputTokens: 1 }),
      }),
      createTurn({
        uuid: 'i',
        timestamp: '2026-10-20T12:00:00.000Z',
        usage: createUsage({ inputTokens: 1 }),
      }),
    ]

    // Act
    const buckets = bucketByDay(turns)

    // Assert
    expect(buckets.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ])
  })

  it('returns an empty array when no turn carries usage', () => {
    // Act
    const buckets = bucketByDay([createTurn({ usage: null })])

    // Assert
    expect(buckets).toEqual([])
  })

  it('passes the model of each turn to the calculator', () => {
    // Arrange
    const seenModels: string[] = []
    const calculator: CostCalculator = (_usage, model) => {
      seenModels.push(model)
      return {
        inputCost: 0,
        outputCost: 0,
        cacheWriteCost: 0,
        cacheReadCost: 0,
        totalCost: 0,
        currency: 'USD',
        unpricedModel: false,
        isEstimated: false,
      }
    }
    const noModel = createTurn({ uuid: 'j', model: null, usage: createUsage({ inputTokens: 1 }) })

    // Act
    bucketByDay([MORNING_TURN, noModel], 0, calculator)

    // Assert
    expect(seenModels).toEqual(['claude-opus-5-5', ''])
  })

  it('keeps bucketing when the calculator throws', () => {
    // Arrange
    const calculator: CostCalculator = () => {
      throw new Error('价目表损坏')
    }

    // Act
    const buckets = bucketByHour([MORNING_TURN], 0, calculator)

    // Assert
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.cost.totalCost).toBe(0)
    expect(buckets[0]?.usage.inputTokens).toBe(100)
  })
})

describe('CostBreakdown shape', () => {
  it('carries exactly the frozen contract fields', () => {
    // Arrange：防止 stats 悄悄往契约里加字段，消费方序列化时会多出噪音
    const buckets = bucketByHour([MORNING_TURN], 0, DOLLAR_PER_MILLION)
    const cost: CostBreakdown = buckets[0]?.cost ?? {
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
      currency: 'USD',
      unpricedModel: false,
      isEstimated: false,
    }

    // Act
    const keys = Object.keys(cost).sort()

    // Assert
    expect(keys).toEqual([
      'cacheReadCost',
      'cacheWriteCost',
      'currency',
      'inputCost',
      'isEstimated',
      'outputCost',
      'totalCost',
      'unpricedModel',
    ])
  })
})
