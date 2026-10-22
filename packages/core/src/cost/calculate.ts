/**
 * 成本计算（docs/PRICING.md §2）
 *
 * ```
 * totalCost = inputTokens     × inputPrice
 *           + cacheCreation   × cacheWritePrice   (TTL 拆分见 §2.1)
 *           + cacheRead       × cacheReadPrice
 *           + output          × outputPrice
 * ```
 *
 * 两个不可协商的红线：
 * 1. 绝不猜价格 —— 无价目的模型成本计 0 并标记 `unpricedModel`；
 * 2. 绝不改入参 —— 所有函数纯函数式，返回全新对象。
 */

import { fastPriceFor, priceFor } from './pricing.js'
import type { CacheWriteSplit, CostBreakdown, CostInput } from './types.js'
import type { ModelPricing, TokenUsage } from '../types.js'

/** 单价以「美元 / 百万 token」计价，换算单 token 成本要除以 1e6 */
const TOKENS_PER_MILLION = 1_000_000

/** 缓存写 1h 价 = 输入价 × 2.0（PRICING.md §1 规则推导） */
const CACHE_WRITE_1H_MULTIPLIER = 2

/** usage 整体缺失时的兜底值；jsonl 是外部数据，任何字段都可能是 undefined */
const ZERO_USAGE: TokenUsage = Object.freeze({
  speed: 'standard',
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  serverToolUse: 0,
})

/** 一次计算实际采用的输入/输出单价，以及是否属于回退估算 */
interface RatePair {
  readonly input: number
  readonly output: number
  readonly isEstimated: boolean
}

/** 无价目模型的结果：全 0，且明确标记「不是估算出来的，是没有数据」 */
const UNPRICED_BREAKDOWN: CostBreakdown = Object.freeze({
  inputCost: 0,
  outputCost: 0,
  cacheWriteCost: 0,
  cacheReadCost: 0,
  totalCost: 0,
  currency: 'USD',
  unpricedModel: true,
  isEstimated: true,
})

/** token 数必须是有限正数；NaN / Infinity / 负数都是脏数据，按 0 计 */
function toSafeTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 单 token 成本 = token 数 / 1e6 × 单价 */
function tokenCost(tokens: number, pricePerMillion: number): number {
  return (toSafeTokenCount(tokens) / TOKENS_PER_MILLION) * pricePerMillion
}

/** 成本字段同样要做脏数据兜底，避免 NaN 顺着聚合链传染 */
function toSafeCost(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * usage 整体不是对象时退到全 0，避免 `null.inputTokens` 直接抛错。
 *
 * 入参标成 unknown 而不是 TokenUsage：这个函数的全部意义就是防御"调用方
 * 传了不是用量的东西"，标成 TokenUsage 会让下面这行检查在类型上变得多余，
 * 于是被人当成死代码删掉——而 jsonl 里什么都有。
 */
function readUsage(usage: unknown): TokenUsage {
  const isUsageObject = typeof usage === 'object' && usage !== null
  return isUsageObject ? (usage as TokenUsage) : ZERO_USAGE
}

/**
 * 决定输入/输出单价。
 *
 * fast 只有部分 Opus 支持：不支持的模型回退标准价并标记估算（PRICING.md §2.2）。
 */
function resolveRates(
  pricing: ModelPricing,
  speed: 'standard' | 'fast' | undefined,
  normalizedModel: string,
): RatePair {
  if (speed !== 'fast') {
    return { input: pricing.input, output: pricing.output, isEstimated: false }
  }

  const fast = fastPriceFor(normalizedModel)
  if (fast === null) {
    return { input: pricing.input, output: pricing.output, isEstimated: true }
  }

  return { input: fast.input, output: fast.output, isEstimated: false }
}

/**
 * 缓存写是否属于估算价。
 *
 * 只有「分项齐全且恰好等于总量」才算精确；缺分项、分项皆为 0、
 * 分项之和与总量不符，都说明这个数字是推出来的。
 */
function isCacheWriteEstimated(
  cacheCreationTokens: number,
  split: CacheWriteSplit | undefined,
): boolean {
  const total = toSafeTokenCount(cacheCreationTokens)
  if (total === 0) {
    return false
  }
  if (split === undefined) {
    return true
  }
  const splitTotal = toSafeTokenCount(split.ephemeral1h) + toSafeTokenCount(split.ephemeral5m)
  return splitTotal !== total
}

/**
 * 计算缓存写成本（PRICING.md §2.1）。
 *
 * @param cacheCreationTokens - `usage.cache_creation_input_tokens` 总量
 * @param pricing - 该模型的标准价，1h 价由 `input × 2` 推导
 * @param split - TTL 分项；缺省表示旧版 jsonl 没有分项信息
 * @returns 缓存写成本（美元）
 */
export function cacheWriteCostOf(
  cacheCreationTokens: number,
  pricing: ModelPricing,
  split?: CacheWriteSplit,
): number {
  const total = toSafeTokenCount(cacheCreationTokens)
  if (total === 0) {
    return 0
  }

  const fiveMinPrice = pricing.cacheWrite
  const fiveMinCost = tokenCost(total, fiveMinPrice)
  if (split === undefined) {
    return fiveMinCost
  }

  const oneHourTokens = toSafeTokenCount(split.ephemeral1h)
  const fiveMinTokens = toSafeTokenCount(split.ephemeral5m)
  const splitTotal = oneHourTokens + fiveMinTokens
  if (splitTotal === 0) {
    // 分项皆为 0 但总量非 0：旧版记录没有 TTL 信息，全部按 5m 价（保守，不低估）
    return fiveMinCost
  }

  const oneHourCost = tokenCost(oneHourTokens, pricing.input * CACHE_WRITE_1H_MULTIPLIER)
  const fiveMinPartCost = tokenCost(fiveMinTokens, fiveMinPrice)
  if (splitTotal === total) {
    return oneHourCost + fiveMinPartCost
  }

  // 分项之和与总量不符：以总量为准，差额按 5m 价补足。
  // 差额为负（分项超出总量）时同样按 5m 价扣减，保证计费 token 恒等于总量。
  const gapTokens = total - splitTotal
  const gapCost = (gapTokens / TOKENS_PER_MILLION) * fiveMinPrice
  return oneHourCost + fiveMinPartCost + gapCost
}

function buildBreakdown(
  inputCost: number,
  outputCost: number,
  cacheWriteCost: number,
  cacheReadCost: number,
  unpricedModel: boolean,
  isEstimated: boolean,
): CostBreakdown {
  const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost,
    currency: 'USD',
    unpricedModel,
    isEstimated,
  }
}

/**
 * 计算一次模型调用的成本，可显式传入缓存写 TTL 拆分。
 *
 * @param input - token 用量 + 模型 + 速度档位
 * @param split - jsonl `usage.cache_creation` 的 TTL 分项；缺省时全部缓存写按 5m 价
 * @returns 成本明细；模型无价目时全 0 且 `unpricedModel` 为 true
 */
export function costOfWithSplit(input: CostInput, split?: CacheWriteSplit): CostBreakdown {
  const lookup = priceFor(input.model)
  if (lookup.pricing === null) {
    return UNPRICED_BREAKDOWN
  }

  const usage = readUsage(input.usage)
  // 显式入参优先，usage 自带的档位作兜底。
  // aggregate 的 costCalculator 签名是 (usage, model)，拿不到单条记录的档位，
  // 只能让它随用量走；而直接调用的方显式传了 speed 时也必须被尊重。
  const speed = input.speed ?? usage.speed
  const rates = resolveRates(lookup.pricing, speed, lookup.normalizedModel)
  const isEstimated = rates.isEstimated || isCacheWriteEstimated(usage.cacheCreationTokens, split)

  return buildBreakdown(
    tokenCost(usage.inputTokens, rates.input),
    tokenCost(usage.outputTokens, rates.output),
    cacheWriteCostOf(usage.cacheCreationTokens, lookup.pricing, split),
    tokenCost(usage.cacheReadTokens, lookup.pricing.cacheRead),
    false,
    isEstimated,
  )
}

/**
 * 计算一次模型调用的成本（不带缓存写 TTL 拆分）。
 *
 * 等价于 `costOfWithSplit(input)`：旧版 jsonl 没有分项，缓存写全部按 5m 价，
 * 因此只要存在缓存写就会标记 `isEstimated`。
 *
 * @param input - token 用量 + 模型 + 速度档位
 * @returns 成本明细
 */
export function costOf(input: CostInput): CostBreakdown {
  return costOfWithSplit(input)
}

/**
 * 汇总多条成本明细。
 *
 * `totalCost` 由四个分项重新相加得出，而不是累加各条的 `totalCost`，
 * 这样即使某一条的分项与总数自相矛盾，汇总结果仍然自洽。
 *
 * @param costs - 待汇总的成本明细，函数不修改入参数组
 * @returns 汇总后的成本明细；空数组返回全 0
 */
export function sumCosts(costs: readonly CostBreakdown[]): CostBreakdown {
  let inputCost = 0
  let outputCost = 0
  let cacheWriteCost = 0
  let cacheReadCost = 0
  let hasUnpricedModel = false
  let hasEstimate = false

  for (const cost of costs) {
    inputCost += toSafeCost(cost.inputCost)
    outputCost += toSafeCost(cost.outputCost)
    cacheWriteCost += toSafeCost(cost.cacheWriteCost)
    cacheReadCost += toSafeCost(cost.cacheReadCost)
    hasUnpricedModel = hasUnpricedModel || cost.unpricedModel
    hasEstimate = hasEstimate || cost.isEstimated
  }

  return buildBreakdown(
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    hasUnpricedModel,
    hasEstimate,
  )
}
