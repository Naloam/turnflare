import { describe, expect, it } from 'vitest'
import {
  addCost,
  addUsage,
  cacheHitRate,
  calculateCost,
  emptyUsage,
  scaleUsage,
  usageTotal,
  zeroCost,
} from './usage'
import type { CostBreakdown, TokenUsage } from '../types'
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

function createCost(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalCost: 0,
    currency: 'USD',
    unpricedModel: false,
    isEstimated: false,
    ...overrides,
  }
}

/**
 * 测试专用的类型逃生舱：把"运行时不遵守契约"的值塞进强类型签名。
 *
 * 契约类型只描述正常路径，而兜底逻辑要防的恰恰是类型说谎的那一刻
 * （字段变成 null / 字符串 / NaN，甚至整个对象不是对象）。
 * 仓库测试统一用 shoehorn 做这件事，本包尚未安装该依赖，
 * 因此收敛到这一个函数里，避免 `as` 散落到每个用例。
 */
function withRuntimeValue<T>(value: unknown): T {
  return value as T
}

describe('emptyUsage', () => {
  it('returns all zero fields', () => {
    // Act
    const usage = emptyUsage()

    // Assert
    expect(usage).toEqual({
      speed: 'standard',
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
  })

  it('returns a fresh object on every call', () => {
    // Act
    const first = emptyUsage()
    const second = emptyUsage()

    // Assert
    expect(first).not.toBe(second)
  })
})

describe('addUsage', () => {
  it('sums every field', () => {
    // Arrange
    const left = createUsage({
      speed: 'standard',
      inputTokens: 100,
      cacheCreationTokens: 20,
      cacheReadTokens: 30,
      outputTokens: 40,
      thinkingTokens: 5,
      serverToolUse: 2,
    })
    const right = createUsage({
      speed: 'standard',
      inputTokens: 1,
      cacheCreationTokens: 2,
      cacheReadTokens: 3,
      outputTokens: 4,
      thinkingTokens: 5,
      serverToolUse: 6,
    })

    // Act
    const sum = addUsage(left, right)

    // Assert
    expect(sum).toEqual(
      createUsage({
        speed: 'standard',
        inputTokens: 101,
        cacheCreationTokens: 22,
        cacheReadTokens: 33,
        outputTokens: 44,
        thinkingTokens: 10,
        serverToolUse: 8,
      }),
    )
  })

  it('does not mutate its operands', () => {
    // Arrange
    const left = createUsage({ inputTokens: 100 })
    const right = createUsage({ inputTokens: 1 })

    // Act
    const sum = addUsage(left, right)

    // Assert
    expect(left.inputTokens).toBe(100)
    expect(right.inputTokens).toBe(1)
    expect(sum).not.toBe(left)
    expect(sum).not.toBe(right)
  })

  it('treats a missing operand as zero usage', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 7 })

    // Act / Assert
    expect(addUsage(usage, withRuntimeValue<TokenUsage>(null))).toEqual(usage)
    expect(addUsage(withRuntimeValue<TokenUsage>(null), usage)).toEqual(usage)
    expect(
      addUsage(withRuntimeValue<TokenUsage>(undefined), withRuntimeValue<TokenUsage>(null)),
    ).toEqual(emptyUsage())
  })

  it('ignores dirty fields instead of propagating NaN', () => {
    // Arrange
    const stringField = withRuntimeValue<TokenUsage>({
      ...createUsage({ inputTokens: 10 }),
      outputTokens: 'not-a-number',
    })
    const nanField = withRuntimeValue<TokenUsage>({
      ...createUsage({ outputTokens: 10 }),
      outputTokens: Number.NaN,
    })
    const negativeField = withRuntimeValue<TokenUsage>({
      ...createUsage({ inputTokens: 10 }),
      speed: 'standard',
      inputTokens: -5,
    })

    // Act
    const sum = addUsage(stringField, nanField)

    // Assert
    expect(sum.outputTokens).toBe(0)
    expect(sum.inputTokens).toBe(10)
    expect(addUsage(negativeField, emptyUsage()).inputTokens).toBe(0)
  })
})

describe('scaleUsage', () => {
  it('multiplies every field by the factor', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 250 })

    // Act
    const scaled = scaleUsage(usage, 0.5)

    // Assert
    expect(scaled.inputTokens).toBe(500)
    expect(scaled.outputTokens).toBe(250)
    expect(scaled.cacheReadTokens).toBe(125)
  })

  it('returns zeros when the factor is not a usable number', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 1000 })

    // Act / Assert
    expect(scaleUsage(usage, Number.NaN)).toEqual(emptyUsage())
    expect(scaleUsage(usage, -1)).toEqual(emptyUsage())
    expect(scaleUsage(usage, withRuntimeValue<number>('2'))).toEqual(emptyUsage())
  })

  it('does not mutate its operand', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 1000 })

    // Act
    scaleUsage(usage, 2)

    // Assert
    expect(usage.inputTokens).toBe(1000)
  })
})

describe('usageTotal', () => {
  it('sums the four billing fields', () => {
    // Arrange
    const usage = createUsage({
      speed: 'standard',
      inputTokens: 40198,
      cacheCreationTokens: 1000,
      cacheReadTokens: 2000,
      outputTokens: 1183,
      thinkingTokens: 500,
      serverToolUse: 3,
    })

    // Act
    const total = usageTotal(usage)

    // Assert
    expect(total).toBe(44381)
  })

  it('excludes thinking tokens and server tool calls', () => {
    // Arrange：思考 token 已含在 outputTokens 里，重复计入会让总量虚高
    const usage = createUsage({ outputTokens: 100, thinkingTokens: 100, serverToolUse: 99 })

    // Act
    const total = usageTotal(usage)

    // Assert
    expect(total).toBe(100)
  })

  it('returns zero for missing usage and for dirty fields', () => {
    // Arrange
    const dirty = withRuntimeValue<TokenUsage>({
      ...createUsage({ inputTokens: 10 }),
      speed: 'standard',
      inputTokens: null,
    })

    // Act / Assert
    expect(usageTotal(withRuntimeValue<TokenUsage>(null))).toBe(0)
    expect(usageTotal(dirty)).toBe(0)
  })
})

describe('cacheHitRate', () => {
  it('divides cache reads by direct input plus cache reads', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 1000, cacheReadTokens: 3000 })

    // Act
    const rate = cacheHitRate(usage)

    // Assert
    expect(rate).toBeCloseTo(0.75, 10)
  })

  it('returns zero when there is neither direct input nor cache reads', () => {
    // Act / Assert
    expect(cacheHitRate(emptyUsage())).toBe(0)
    expect(cacheHitRate(createUsage({ outputTokens: 500 }))).toBe(0)
  })

  it('returns one when every input token came from cache', () => {
    // Arrange
    const usage = createUsage({ cacheReadTokens: 500 })

    // Act
    const rate = cacheHitRate(usage)

    // Assert
    expect(rate).toBe(1)
  })

  it('stays within the zero to one range when a token count is dirty', () => {
    // Arrange：负的 inputTokens 是脏数据，按 0 计后全部输入都来自缓存
    const negativeInput = withRuntimeValue<TokenUsage>({
      ...createUsage({ inputTokens: 100, cacheReadTokens: 100 }),
      speed: 'standard',
      inputTokens: -100,
    })
    const nonNumericInput = withRuntimeValue<TokenUsage>({
      ...createUsage({ cacheReadTokens: 100 }),
      speed: 'standard',
      inputTokens: 'many',
    })

    // Act
    const negativeRate = cacheHitRate(negativeInput)
    const nonNumericRate = cacheHitRate(nonNumericInput)

    // Assert
    expect(negativeRate).toBe(1)
    expect(nonNumericRate).toBe(1)
  })

  it('returns zero when every token count is dirty', () => {
    // Arrange
    const usage = withRuntimeValue<TokenUsage>({
      speed: 'standard',
      inputTokens: null,
      cacheReadTokens: 'all of them',
      outputTokens: 10,
    })

    // Act
    const rate = cacheHitRate(usage)

    // Assert
    expect(rate).toBe(0)
  })
})

describe('zeroCost', () => {
  it('returns a zeroed breakdown priced in USD with both markers cleared', () => {
    // Act
    const cost = zeroCost()

    // Assert
    expect(cost).toEqual({
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
      currency: 'USD',
      unpricedModel: false,
      isEstimated: false,
    })
  })
})

describe('addCost', () => {
  it('sums every cost component', () => {
    // Arrange
    const left = createCost({ inputCost: 0.004, outputCost: 0.01, cacheReadCost: 0.002 })
    const right = createCost({ inputCost: 0.001, cacheWriteCost: 0.5 })

    // Act
    const sum = addCost(left, right)

    // Assert
    expect(sum.inputCost).toBeCloseTo(0.005, 10)
    expect(sum.outputCost).toBeCloseTo(0.01, 10)
    expect(sum.cacheWriteCost).toBeCloseTo(0.5, 10)
    expect(sum.cacheReadCost).toBeCloseTo(0.002, 10)
    expect(sum.totalCost).toBeCloseTo(0.517, 10)
    expect(sum.currency).toBe('USD')
  })

  it('recomputes totalCost from the parts so a self-contradictory input stays consistent', () => {
    // Arrange：totalCost 与分项自相矛盾的脏数据
    const contradictory = createCost({ inputCost: 1, totalCost: 999 })

    // Act
    const sum = addCost(contradictory, zeroCost())

    // Assert
    expect(sum.totalCost).toBe(1)
  })

  it('ignores non-finite components', () => {
    // Arrange
    const dirty = createCost({ inputCost: Number.NaN, outputCost: 1 })

    // Act
    const sum = addCost(dirty, zeroCost())

    // Assert
    expect(sum.inputCost).toBe(0)
    expect(sum.outputCost).toBe(1)
    expect(sum.totalCost).toBe(1)
  })

  it('propagates a pricing marker as soon as one side carries it', () => {
    // Arrange：下游只需要知道「这批数据里存在估算成分」，不需要知道是哪一条
    const unpriced = createCost({ unpricedModel: true })
    const estimated = createCost({ isEstimated: true })

    // Act
    const sum = addCost(unpriced, estimated)
    const clean = addCost(createCost(), createCost())

    // Assert
    expect(sum.unpricedModel).toBe(true)
    expect(sum.isEstimated).toBe(true)
    expect(clean.unpricedModel).toBe(false)
    expect(clean.isEstimated).toBe(false)
  })

  it('treats a missing operand as zero cost', () => {
    // Arrange
    const cost = createCost({ inputCost: 0.5, totalCost: 0.5 })

    // Act
    const sum = addCost(cost, withRuntimeValue<CostBreakdown>(null))

    // Assert
    expect(sum).toEqual(cost)
  })
})

describe('calculateCost', () => {
  it('delegates to the injected calculator', () => {
    // Arrange
    const calculator: CostCalculator = (usage, model) =>
      createCost({ inputCost: usage.inputTokens / 1_000_000, outputCost: model === 'x' ? 1 : 0 })

    // Act
    const cost = calculateCost(createUsage({ inputTokens: 1_000_000 }), 'x', calculator)

    // Assert
    expect(cost.inputCost).toBe(1)
    expect(cost.outputCost).toBe(1)
    expect(cost.totalCost).toBe(2)
    expect(cost.currency).toBe('USD')
  })

  it('passes an empty model string through when the record has no model', () => {
    // Arrange
    const seenModels: string[] = []
    const calculator: CostCalculator = (_usage, model) => {
      seenModels.push(model)
      return zeroCost()
    }

    // Act
    calculateCost(createUsage(), '', calculator)

    // Assert
    expect(seenModels).toEqual([''])
  })

  it('reports zero money but flags the model as unpriced when no calculator is assembled', () => {
    // Act
    const cost = calculateCost(createUsage({ inputTokens: 1_000_000 }), 'claude-opus-5-5', null)

    // Assert：钱是 0，但必须说明「算不出来」而不是「不要钱」
    expect(cost).toEqual({ ...zeroCost(), unpricedModel: true })
  })

  it('flags the model as unpriced when the calculator throws', () => {
    // Arrange
    const calculator: CostCalculator = () => {
      throw new Error('价目表损坏')
    }

    // Act
    const cost = calculateCost(createUsage({ inputTokens: 1 }), 'claude-opus-5-5', calculator)

    // Assert
    expect(cost).toEqual({ ...zeroCost(), unpricedModel: true })
  })

  it('flags the model as unpriced when the calculator returns a non-object', () => {
    // Arrange
    const calculator = withRuntimeValue<CostCalculator>(() => 'oops')

    // Act
    const cost = calculateCost(createUsage({ inputTokens: 1 }), 'claude-opus-5-5', calculator)

    // Assert
    expect(cost).toEqual({ ...zeroCost(), unpricedModel: true })
  })

  it('sanitizes the calculator result and recomputes totalCost', () => {
    // Arrange
    const calculator: CostCalculator = () =>
      createCost({ inputCost: 1, outputCost: Number.NaN, totalCost: 999 })

    // Act
    const cost = calculateCost(createUsage(), 'model', calculator)

    // Assert
    expect(cost.inputCost).toBe(1)
    expect(cost.outputCost).toBe(0)
    expect(cost.totalCost).toBe(1)
  })

  it('carries the pricing markers reported by the calculator', () => {
    // Arrange
    const calculator: CostCalculator = () =>
      createCost({ inputCost: 1, unpricedModel: true, isEstimated: true })

    // Act
    const cost = calculateCost(createUsage(), 'model', calculator)

    // Assert
    expect(cost.unpricedModel).toBe(true)
    expect(cost.isEstimated).toBe(true)
  })

  it('defaults the pricing markers to false when the calculator omits them', () => {
    // Arrange：返回的是对象，只是没带标记位 —— 按"没有标记"处理
    const calculator = withRuntimeValue<CostCalculator>(() => ({ inputCost: 1 }))

    // Act
    const cost = calculateCost(createUsage(), 'model', calculator)

    // Assert
    expect(cost.inputCost).toBe(1)
    expect(cost.unpricedModel).toBe(false)
    expect(cost.isEstimated).toBe(false)
  })

  it('returns an equal but independent breakdown on every call', () => {
    // Arrange
    const usage = createUsage({ inputTokens: 5 })
    const calculator: CostCalculator = () => createCost({ inputCost: 0.25 })

    // Act
    const first = calculateCost(usage, 'model', calculator)
    const second = calculateCost(usage, 'model', calculator)

    // Assert
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})
