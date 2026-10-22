import { describe, expect, it } from 'vitest'
import { cacheWriteCostOf, costOf, costOfWithSplit, sumCosts } from './calculate'
import type { CostBreakdown, CostInput } from './types'
import type { ModelPricing, TokenUsage } from '../types'

/** 基准模型：input 4 / output 20 / 5m 缓存写 5 / 1h 缓存写 8 / 缓存读 0.2 */
const OPUS_5_5 = 'claude-opus-5-5'

/** 独立抄录的基准单价，避免测试与价目表互相背书 */
const OPUS_5_5_PRICING: ModelPricing = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }

/** 百万 token：单价表按 $/MTok 计价，1M token 的成本数值上正好等于单价 */
const ONE_MILLION = 1_000_000

function createUsage(overrides: Partial<TokenUsage>): TokenUsage {
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

/** PRICING.md §1 的独立抄录，用来验证 MODEL_PRICING 没有录错 */
interface ModelCostCase {
  readonly model: string
  readonly input: number
  readonly output: number
  readonly cacheWrite: number
  readonly cacheRead: number
}

const MODEL_COST_CASES: readonly ModelCostCase[] = [
  { model: 'claude-fable-5-1', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  { model: 'claude-fable-5', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  { model: 'claude-mythos-5-1', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  { model: 'claude-opus-5-5', input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  { model: 'claude-opus-5', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  { model: 'claude-opus-4-8', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  { model: 'claude-opus-4-7', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  { model: 'claude-opus-4-6', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  { model: 'claude-sonnet-5-5', input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { model: 'claude-sonnet-5', input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  { model: 'claude-sonnet-4-6', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { model: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  { model: 'claude-haiku-4-5', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
]

/** 全字段 100 万 token 的用量：每项成本数值上等于该项单价 */
const FULL_USAGE: TokenUsage = Object.freeze(
  createUsage({
    speed: 'standard',
    inputTokens: ONE_MILLION,
    outputTokens: ONE_MILLION,
    cacheCreationTokens: ONE_MILLION,
    cacheReadTokens: ONE_MILLION,
  }),
)

describe('costOf', () => {
  it('matches the hand-computed example from the spec', () => {
    // Arrange: 1000/1e6*4 = 0.004；500/1e6*20 = 0.01；10000/1e6*0.2 = 0.002
    const input: CostInput = {
      usage: createUsage({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000 }),
      model: OPUS_5_5,
    }

    // Act
    const result = costOf(input)

    // Assert
    expect(result.inputCost).toBeCloseTo(0.004, 10)
    expect(result.outputCost).toBeCloseTo(0.01, 10)
    expect(result.cacheReadCost).toBeCloseTo(0.002, 10)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.totalCost).toBeCloseTo(0.016, 10)
    expect(result.currency).toBe('USD')
    expect(result.unpricedModel).toBe(false)
    expect(result.isEstimated).toBe(false)
  })

  it.each(MODEL_COST_CASES)(
    'prices $model at the rates transcribed from PRICING.md §1',
    (testCase) => {
      const input: CostInput = { usage: FULL_USAGE, model: testCase.model }

      const result = costOf(input)

      expect(result.inputCost).toBeCloseTo(testCase.input, 10)
      expect(result.outputCost).toBeCloseTo(testCase.output, 10)
      expect(result.cacheWriteCost).toBeCloseTo(testCase.cacheWrite, 10)
      expect(result.cacheReadCost).toBeCloseTo(testCase.cacheRead, 10)
      expect(result.totalCost).toBeCloseTo(
        testCase.input + testCase.output + testCase.cacheWrite + testCase.cacheRead,
        10,
      )
    },
  )

  it('prices a model id that carries deployment noise', () => {
    const input: CostInput = {
      usage: FULL_USAGE,
      model: 'us.anthropic.claude-opus-5-5-20261001_v1:0',
    }

    expect(costOf(input).totalCost).toBeCloseTo(29.2, 10)
  })

  it('returns zero cost for every field when the usage is empty', () => {
    const input: CostInput = { usage: createUsage({}), model: OPUS_5_5 }

    const result = costOf(input)

    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.cacheReadCost).toBe(0)
    expect(result.totalCost).toBe(0)
    expect(result.unpricedModel).toBe(false)
    expect(result.isEstimated).toBe(false)
  })

  it('marks an unknown model as unpriced instead of guessing a price', () => {
    const input: CostInput = { usage: FULL_USAGE, model: 'step-5-preview' }

    const result = costOf(input)

    expect(result.unpricedModel).toBe(true)
    expect(result.totalCost).toBe(0)
    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.cacheReadCost).toBe(0)
  })

  it('marks an unknown model as unpriced even in fast mode', () => {
    const input: CostInput = { usage: FULL_USAGE, model: 'step-5-preview', speed: 'fast' }

    expect(costOf(input).unpricedModel).toBe(true)
    expect(costOf(input).totalCost).toBe(0)
  })

  it('treats malformed usage fields as zero', () => {
    // Arrange: jsonl 反序列化出来的脏 usage —— 字符串、null、字段缺失
    const dirtyUsage = JSON.parse(
      '{"inputTokens":"40198","outputTokens":null,"cacheReadTokens":[]}',
    )
    const input: CostInput = { usage: dirtyUsage, model: OPUS_5_5 }

    // Act
    const result = costOf(input)

    // Assert
    expect(result.totalCost).toBe(0)
  })

  it('treats a missing usage object as zero', () => {
    const nullishUsage = JSON.parse('null')
    const input: CostInput = { usage: nullishUsage, model: OPUS_5_5 }

    expect(costOf(input).totalCost).toBe(0)
  })

  it('ignores negative, NaN and infinite token counts', () => {
    const input: CostInput = {
      usage: createUsage({
        speed: 'standard',
        inputTokens: -500,
        outputTokens: Number.NaN,
        cacheCreationTokens: Number.POSITIVE_INFINITY,
        cacheReadTokens: 10000,
      }),
      model: OPUS_5_5,
    }

    const result = costOf(input)

    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.cacheReadCost).toBeCloseTo(0.002, 10)
  })

  it('does not mutate the frozen input', () => {
    const input: CostInput = Object.freeze({
      usage: Object.freeze(createUsage({ inputTokens: 1000, cacheCreationTokens: 12000 })),
      model: OPUS_5_5,
      speed: 'fast',
    })

    expect(() => costOf(input)).not.toThrow()
    expect(input.usage.inputTokens).toBe(1000)
    expect(input.usage.cacheCreationTokens).toBe(12000)
    expect(input.model).toBe(OPUS_5_5)
    expect(input.speed).toBe('fast')
  })

  it('keeps totalCost equal to the sum of its parts', () => {
    const input: CostInput = {
      usage: createUsage({
        speed: 'standard',
        inputTokens: 40198,
        outputTokens: 1183,
        cacheCreationTokens: 12000,
        cacheReadTokens: 250000,
      }),
      model: 'claude-sonnet-4-6',
    }

    const result = costOf(input)

    expect(result.totalCost).toBeCloseTo(
      result.inputCost + result.outputCost + result.cacheWriteCost + result.cacheReadCost,
      12,
    )
  })
})

describe('costOfWithSplit', () => {
  const CACHE_WRITE_USAGE: TokenUsage = Object.freeze(createUsage({ cacheCreationTokens: 12000 }))

  it('charges the whole cache write at the 1h price when only the 1h split is present', () => {
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    const result = costOfWithSplit(input, { ephemeral1h: 12000, ephemeral5m: 0 })

    // 12000/1e6*8 = 0.096
    expect(result.cacheWriteCost).toBeCloseTo(0.096, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('charges the whole cache write at the 5m price when only the 5m split is present', () => {
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    const result = costOfWithSplit(input, { ephemeral1h: 0, ephemeral5m: 12000 })

    // 12000/1e6*5 = 0.06
    expect(result.cacheWriteCost).toBeCloseTo(0.06, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('splits the cache write across both TTL prices', () => {
    // Arrange: docs/PRICING.md §2.1 的示例数字
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    // Act: 8000/1e6*8 + 4000/1e6*5 = 0.064 + 0.02
    const result = costOfWithSplit(input, { ephemeral1h: 8000, ephemeral5m: 4000 })

    // Assert
    expect(result.cacheWriteCost).toBeCloseTo(0.084, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('falls back to the 5m price when both splits are zero but the total is not', () => {
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    const result = costOfWithSplit(input, { ephemeral1h: 0, ephemeral5m: 0 })

    expect(result.cacheWriteCost).toBeCloseTo(0.06, 10)
    expect(result.isEstimated).toBe(true)
  })

  it('falls back to the 5m price when no split is supplied', () => {
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    const result = costOfWithSplit(input)

    expect(result.cacheWriteCost).toBeCloseTo(0.06, 10)
    expect(result.isEstimated).toBe(true)
  })

  it('tops up the gap at the 5m price when the splits sum below the total', () => {
    // Arrange: 5000 + 3000 = 8000，比总量 12000 少 4000
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    // Act: 5000/1e6*8 + 3000/1e6*5 + 4000/1e6*5 = 0.04 + 0.015 + 0.02
    const result = costOfWithSplit(input, { ephemeral1h: 5000, ephemeral5m: 3000 })

    // Assert
    expect(result.cacheWriteCost).toBeCloseTo(0.075, 10)
    expect(result.isEstimated).toBe(true)
  })

  it('deducts the excess at the 5m price when the splits sum above the total', () => {
    // Arrange: 8000 + 4000 = 12000，比总量 10000 多 2000
    const input: CostInput = { usage: createUsage({ cacheCreationTokens: 10000 }), model: OPUS_5_5 }

    // Act: 8000/1e6*8 + 4000/1e6*5 - 2000/1e6*5 = 0.064 + 0.02 - 0.01
    const result = costOfWithSplit(input, { ephemeral1h: 8000, ephemeral5m: 4000 })

    // Assert
    expect(result.cacheWriteCost).toBeCloseTo(0.074, 10)
    expect(result.isEstimated).toBe(true)
  })

  it('ignores negative split values', () => {
    const input: CostInput = { usage: CACHE_WRITE_USAGE, model: OPUS_5_5 }

    const result = costOfWithSplit(input, { ephemeral1h: -8000, ephemeral5m: 12000 })

    expect(result.cacheWriteCost).toBeCloseTo(0.06, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('does not mark an estimate when the cache write is absent', () => {
    const input: CostInput = { usage: createUsage({ inputTokens: 1000 }), model: OPUS_5_5 }

    const result = costOfWithSplit(input, { ephemeral1h: 0, ephemeral5m: 0 })

    expect(result.cacheWriteCost).toBe(0)
    expect(result.isEstimated).toBe(false)
  })
})

describe('fast mode', () => {
  const FAST_USAGE: TokenUsage = createUsage({
    speed: 'standard',
    inputTokens: ONE_MILLION,
    outputTokens: ONE_MILLION,
    cacheReadTokens: ONE_MILLION,
  })

  it('uses the fast price for a model that supports fast mode', () => {
    const input: CostInput = { usage: FAST_USAGE, model: OPUS_5_5, speed: 'fast' }

    const result = costOf(input)

    expect(result.inputCost).toBeCloseTo(8, 10)
    expect(result.outputCost).toBeCloseTo(40, 10)
    // 缓存价不随 fast 涨价
    expect(result.cacheReadCost).toBeCloseTo(0.2, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('uses the fast price for claude-opus-4-8', () => {
    const input: CostInput = { usage: FAST_USAGE, model: 'claude-opus-4-8', speed: 'fast' }

    expect(costOf(input).totalCost).toBeCloseTo(60.25, 10)
  })

  it('falls back to the standard price and flags an estimate without a fast price', () => {
    const input: CostInput = { usage: FAST_USAGE, model: 'claude-sonnet-5-5', speed: 'fast' }

    const result = costOf(input)

    expect(result.inputCost).toBeCloseTo(2, 10)
    expect(result.outputCost).toBeCloseTo(10, 10)
    expect(result.isEstimated).toBe(true)
  })

  it('treats a missing speed as standard', () => {
    const input: CostInput = { usage: FAST_USAGE, model: OPUS_5_5 }

    const result = costOf(input)

    expect(result.inputCost).toBeCloseTo(4, 10)
    expect(result.outputCost).toBeCloseTo(20, 10)
    expect(result.isEstimated).toBe(false)
  })

  it('treats an explicit standard speed the same as a missing speed', () => {
    const input: CostInput = { usage: FAST_USAGE, model: OPUS_5_5, speed: 'standard' }

    expect(costOf(input).totalCost).toBeCloseTo(24.2, 10)
  })
})

describe('cacheWriteCostOf', () => {
  it('returns zero when there are no cache write tokens', () => {
    expect(cacheWriteCostOf(0, OPUS_5_5_PRICING)).toBe(0)
  })

  it('charges the 5m price when no split is supplied', () => {
    // 12000/1e6*5 = 0.06
    expect(cacheWriteCostOf(12000, OPUS_5_5_PRICING)).toBeCloseTo(0.06, 10)
  })

  it('charges the 1h price for the 1h portion and the 5m price for the rest', () => {
    const cost = cacheWriteCostOf(12000, OPUS_5_5_PRICING, {
      ephemeral1h: 8000,
      ephemeral5m: 4000,
    })

    expect(cost).toBeCloseTo(0.084, 10)
  })

  it('charges the 1h price as twice the input price', () => {
    // 1000/1e6*(4*2) = 0.008
    const cost = cacheWriteCostOf(1000, OPUS_5_5_PRICING, {
      ephemeral1h: 1000,
      ephemeral5m: 0,
    })

    expect(cost).toBeCloseTo(0.008, 10)
  })

  it('returns zero for a NaN token count', () => {
    expect(cacheWriteCostOf(Number.NaN, OPUS_5_5_PRICING)).toBe(0)
  })
})

describe('sumCosts', () => {
  it('returns an all-zero breakdown for an empty list', () => {
    const result = sumCosts([])

    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.cacheReadCost).toBe(0)
    expect(result.totalCost).toBe(0)
    expect(result.unpricedModel).toBe(false)
    expect(result.isEstimated).toBe(false)
  })

  it('reproduces a single breakdown', () => {
    const single = costOf({
      usage: createUsage({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000 }),
      model: OPUS_5_5,
    })

    const result = sumCosts([single])

    expect(result).toEqual(single)
  })

  it('adds up the component costs of every breakdown', () => {
    const first = costOf({
      usage: createUsage({ inputTokens: ONE_MILLION, outputTokens: ONE_MILLION }),
      model: OPUS_5_5,
    })
    const second = costOf({
      usage: createUsage({ inputTokens: ONE_MILLION, cacheReadTokens: ONE_MILLION }),
      model: 'claude-haiku-5-5',
    })

    const result = sumCosts([first, second])

    // 4 + 0.1 = 4.1；20；0；0 + 0.01 = 0.01
    expect(result.inputCost).toBeCloseTo(4.1, 10)
    expect(result.outputCost).toBeCloseTo(20, 10)
    expect(result.cacheWriteCost).toBe(0)
    expect(result.cacheReadCost).toBeCloseTo(0.01, 10)
    expect(result.totalCost).toBeCloseTo(24.11, 10)
  })

  it('propagates the unpriced model flag', () => {
    const priced = costOf({ usage: createUsage({ inputTokens: 1000 }), model: OPUS_5_5 })
    const unpriced = costOf({ usage: createUsage({ inputTokens: 1000 }), model: 'step-5-preview' })

    expect(sumCosts([priced, unpriced]).unpricedModel).toBe(true)
    expect(sumCosts([priced, priced]).unpricedModel).toBe(false)
  })

  it('propagates the estimated flag', () => {
    const exact = costOf({ usage: createUsage({ inputTokens: 1000 }), model: OPUS_5_5 })
    const estimated = costOf({
      usage: createUsage({ inputTokens: 1000 }),
      model: OPUS_5_5,
      speed: 'fast',
    })

    expect(estimated.isEstimated).toBe(false)
    const withEstimate = costOf({
      usage: createUsage({ cacheCreationTokens: 12000 }),
      model: OPUS_5_5,
    })

    expect(withEstimate.isEstimated).toBe(true)
    expect(sumCosts([exact, withEstimate]).isEstimated).toBe(true)
    expect(sumCosts([exact, exact]).isEstimated).toBe(false)
  })

  it('does not mutate the input array', () => {
    const costs: readonly CostBreakdown[] = [
      costOf({ usage: createUsage({ inputTokens: 1000 }), model: OPUS_5_5 }),
      costOf({ usage: createUsage({ inputTokens: 2000 }), model: OPUS_5_5 }),
    ]
    const before = costs.length

    sumCosts(costs)

    expect(costs.length).toBe(before)
    expect(costs[0]?.inputCost).toBeCloseTo(0.004, 10)
    expect(costs[1]?.inputCost).toBeCloseTo(0.008, 10)
  })

  it('recomputes totalCost from the components even when a part disagrees', () => {
    const inconsistent: CostBreakdown = {
      inputCost: 1,
      outputCost: 2,
      cacheWriteCost: 3,
      cacheReadCost: 4,
      totalCost: 999,
      currency: 'USD',
      unpricedModel: false,
      isEstimated: false,
    }

    expect(sumCosts([inconsistent]).totalCost).toBe(10)
  })

  it('treats non-finite component costs as zero', () => {
    const dirty: CostBreakdown = {
      inputCost: Number.NaN,
      outputCost: Number.POSITIVE_INFINITY,
      cacheWriteCost: 2,
      cacheReadCost: 3,
      totalCost: 0,
      currency: 'USD',
      unpricedModel: false,
      isEstimated: false,
    }

    const result = sumCosts([dirty])

    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
    expect(result.cacheWriteCost).toBe(2)
    expect(result.cacheReadCost).toBe(3)
    expect(result.totalCost).toBe(5)
  })
})
