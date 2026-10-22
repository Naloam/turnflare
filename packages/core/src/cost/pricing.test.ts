import { describe, expect, it } from 'vitest'
import { FAST_PRICING, MODEL_PRICING, allModelIds, fastPriceFor, priceFor } from './pricing'
import type { ModelPricing } from '../types'

/** PRICING.md §1 的全部 13 个模型，顺序与文档表格一致 */
const EXPECTED_MODEL_IDS: readonly string[] = [
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
]

/** PRICING.md §1 的缓存读列独立抄录：多数模型是输入价 x 0.1，但 Opus/Fable/Haiku 是官方特价 */
const EXPECTED_CACHE_READ: Readonly<Record<string, number>> = {
  'claude-fable-5-1': 0.25,
  'claude-fable-5': 0.25,
  'claude-mythos-5-1': 0.25,
  'claude-opus-5-5': 0.2,
  'claude-opus-5': 0.25,
  'claude-opus-4-8': 0.25,
  'claude-opus-4-7': 0.25,
  'claude-opus-4-6': 0.25,
  'claude-sonnet-5-5': 0.2,
  'claude-sonnet-5': 0.2,
  'claude-sonnet-4-6': 0.3,
  'claude-haiku-5-5': 0.01,
  'claude-haiku-4-5': 0.1,
}

/** PRICING.md §1 的 Fast 列，仅三个 Opus 模型支持 */
const EXPECTED_FAST_PRICING: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-opus-5-5': { input: 8, output: 40 },
  'claude-opus-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 10, output: 50 },
}

/** 缓存写 5m = 输入价 × 1.25，1h = 输入价 × 2.0（PRICING.md §1 规则推导） */
const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2

describe('MODEL_PRICING', () => {
  it('registers exactly the 13 models from PRICING.md §1', () => {
    expect(allModelIds()).toEqual(EXPECTED_MODEL_IDS)
  })

  it('derives the 5m cache write price from the input price', () => {
    for (const pricing of Object.values(MODEL_PRICING)) {
      expect(pricing.cacheWrite).toBeCloseTo(pricing.input * CACHE_WRITE_5M_MULTIPLIER, 12)
      expect(pricing.input).toBeGreaterThan(0)
      expect(pricing.output).toBeGreaterThan(0)
    }
  })

  it('derives the 1h cache write price as 1.6x the stored 5m price', () => {
    // 5m = input x 1.25、1h = input x 2.0，因此 1h / 5m 恒为 1.6
    const oneHourOverFiveMin = CACHE_WRITE_1H_MULTIPLIER / CACHE_WRITE_5M_MULTIPLIER

    for (const pricing of Object.values(MODEL_PRICING)) {
      const oneHourPrice = pricing.input * CACHE_WRITE_1H_MULTIPLIER
      expect(oneHourPrice).toBeCloseTo(pricing.cacheWrite * oneHourOverFiveMin, 12)
    }
  })

  it('records the cache read column exactly as documented', () => {
    for (const [modelId, cacheRead] of Object.entries(EXPECTED_CACHE_READ)) {
      const pricing: ModelPricing | undefined = MODEL_PRICING[modelId]
      expect(pricing).toBeDefined()
      expect(pricing?.cacheRead).toBe(cacheRead)
    }
  })

  it('keeps the cache read price below the 5m cache write price for every model', () => {
    for (const pricing of Object.values(MODEL_PRICING)) {
      expect(pricing.cacheRead).toBeLessThan(pricing.cacheWrite)
    }
  })

  it('keeps the output price above the input price for every model', () => {
    for (const pricing of Object.values(MODEL_PRICING)) {
      expect(pricing.output).toBeGreaterThan(pricing.input)
    }
  })
})

describe('FAST_PRICING', () => {
  it('only prices the Opus models that support fast mode', () => {
    expect(Object.keys(FAST_PRICING)).toEqual(Object.keys(EXPECTED_FAST_PRICING))
  })

  it('charges roughly twice the standard input and output price', () => {
    for (const [modelId, fast] of Object.entries(EXPECTED_FAST_PRICING)) {
      const standard: ModelPricing | undefined = MODEL_PRICING[modelId]
      expect(standard).toBeDefined()
      expect(fast.input).toBeCloseTo((standard?.input ?? 0) * 2, 12)
      expect(fast.output).toBeCloseTo((standard?.output ?? 0) * 2, 12)
    }
  })
})

describe('priceFor', () => {
  it('returns the exact pricing for a registered model', () => {
    const lookup = priceFor('claude-opus-5-5')

    expect(lookup.pricing).toEqual({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 })
    expect(lookup.normalizedModel).toBe('claude-opus-5-5')
    expect(lookup.isEstimated).toBe(false)
  })

  it('normalizes the model id before looking it up', () => {
    const lookup = priceFor('us.anthropic.claude-opus-5-5-20261001_v1:0')

    expect(lookup.normalizedModel).toBe('claude-opus-5-5')
    expect(lookup.pricing).toEqual(MODEL_PRICING['claude-opus-5-5'])
    expect(lookup.isEstimated).toBe(false)
  })

  it('returns null pricing for an unknown model', () => {
    const lookup = priceFor('step-5-preview')

    expect(lookup.pricing).toBeNull()
    expect(lookup.normalizedModel).toBe('step-5-preview')
    expect(lookup.isEstimated).toBe(true)
  })

  it('returns null pricing for an empty model id', () => {
    expect(priceFor('').pricing).toBeNull()
  })

  it('does not resolve inherited object keys as prices', () => {
    for (const prototypeKey of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(priceFor(prototypeKey).pricing).toBeNull()
    }
  })
})

describe('fastPriceFor', () => {
  it('returns the fast price for a model that supports fast mode', () => {
    expect(fastPriceFor('claude-opus-5-5')).toEqual({ input: 8, output: 40 })
  })

  it('normalizes the model id before looking up the fast price', () => {
    expect(fastPriceFor('anthropic.claude-opus-4-8-20260101')).toEqual({ input: 10, output: 50 })
  })

  it('returns null for a model without a fast price', () => {
    expect(fastPriceFor('claude-sonnet-5-5')).toBeNull()
    expect(fastPriceFor('claude-haiku-5-5')).toBeNull()
  })

  it('returns null for an unknown model', () => {
    expect(fastPriceFor('step-5-preview')).toBeNull()
  })
})

describe('allModelIds', () => {
  it('returns a fresh array on every call', () => {
    const first = allModelIds()
    const second = allModelIds()

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})
