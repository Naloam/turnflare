/**
 * @turnflare/core —— stats 的不可变算术
 *
 * 两条红线：
 * 1. 绝不改写入参，一律返回全新对象。聚合链上任何一环返回共享引用，
 *    都会让上游的中间结果被下游悄悄改写；
 * 2. 脏数据在这里收敛。jsonl 的数值字段可能是 NaN / 负数 / 字符串，
 *    全部经 `narrow` 助手过滤后才参与运算，否则一个 NaN 就能把整张报表的
 *    成本栏污染成 NaN。
 *
 * 本文件同时承载 stats 内部共享的成本兜底策略（`zeroCost` / `addCost` /
 * `calculateCost`）：成本模块与本模块并行开发，stats 不能 import 它，
 * 所以"没有计算器时成本记 0"这条策略必须落在 stats 内部，
 * 且 bucket / aggregate 两处都要用 —— 放这里是为了不复制第二份。
 */

import type { CostBreakdown, TokenUsage } from '../types.js'
import type { CostCalculator } from './types.js'
import { isPlainObject, isPresent, readFiniteNumber, readPositiveNumber } from './narrow.js'

/** 全 0 用量；冻结后共享给所有缺省路径，任何代码都无法改写它 */
const ZERO_USAGE: TokenUsage = Object.freeze({
  speed: 'standard',
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  serverToolUse: 0,
})

/**
 * 全 0 成本（未装配成本计算器时的占位）。
 *
 * 两个标记位都必须是 false：这不是"估算出来的 0"，而是"压根没有价目数据
 * 可算"的 0，两者对下游的含义完全不同。
 */
const ZERO_COST: CostBreakdown = Object.freeze({
  inputCost: 0,
  outputCost: 0,
  cacheWriteCost: 0,
  cacheReadCost: 0,
  totalCost: 0,
  currency: 'USD',
  unpricedModel: false,
  isEstimated: false,
})

/** usage 整体缺失时退到全 0，避免 `null.inputTokens` 直接抛错 */
function toUsage(value: TokenUsage | null | undefined): TokenUsage {
  return isPresent(value) ? value : ZERO_USAGE
}

/** 成本整体缺失时退到全 0 */
function toCost(value: CostBreakdown | null | undefined): CostBreakdown {
  return isPresent(value) ? value : ZERO_COST
}

/** 读 usage 的单个字段并做脏数据兜底 */
function usageField(usage: TokenUsage, field: keyof TokenUsage): number {
  const raw: unknown = usage[field]
  return readPositiveNumber(raw)
}

/** 读成本分项；非有限数按 0 计 */
function costPart(value: unknown): number {
  return readFiniteNumber(value) ?? 0
}

/**
 * 返回一份全新的全 0 用量。
 *
 * 每次调用都新建对象：调用方把结果存进可变结构时，不会波及其他人。
 */
export function emptyUsage(): TokenUsage {
  return { ...ZERO_USAGE }
}

/**
 * 两份用量相加，返回新对象（任一入参为 null / undefined 时按全 0 计）。
 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const left = toUsage(a)
  const right = toUsage(b)
  return {
    // 档位不可加：聚合之后它不再代表任何一次请求。成本是在 turn 级逐条算清
    // 再相加的，不会走到"对聚合值调 costOf"这条路，所以这里保留左值只为
    // 让字段有个确定来源，不具备计价意义。
    speed: left.speed,
    inputTokens: usageField(left, 'inputTokens') + usageField(right, 'inputTokens'),
    cacheCreationTokens:
      usageField(left, 'cacheCreationTokens') + usageField(right, 'cacheCreationTokens'),
    cacheReadTokens: usageField(left, 'cacheReadTokens') + usageField(right, 'cacheReadTokens'),
    outputTokens: usageField(left, 'outputTokens') + usageField(right, 'outputTokens'),
    thinkingTokens: usageField(left, 'thinkingTokens') + usageField(right, 'thinkingTokens'),
    serverToolUse: usageField(left, 'serverToolUse') + usageField(right, 'serverToolUse'),
  }
}

/**
 * 按系数缩放用量，返回新对象。
 *
 * 系数非正数或非有限数时按 0 计（脏数据兜底），因此结果不会是负数。
 */
export function scaleUsage(u: TokenUsage, factor: number): TokenUsage {
  const usage = toUsage(u)
  const scale = readPositiveNumber(factor)
  return {
    speed: usage.speed,
    inputTokens: usageField(usage, 'inputTokens') * scale,
    cacheCreationTokens: usageField(usage, 'cacheCreationTokens') * scale,
    cacheReadTokens: usageField(usage, 'cacheReadTokens') * scale,
    outputTokens: usageField(usage, 'outputTokens') * scale,
    thinkingTokens: usageField(usage, 'thinkingTokens') * scale,
    serverToolUse: usageField(usage, 'serverToolUse') * scale,
  }
}

/**
 * 计费总量 = 输入 + 缓存写 + 缓存读 + 输出。
 *
 * 思考 token 已包含在 outputTokens 里，不重复计入，否则总量会虚高。
 */
export function usageTotal(u: TokenUsage): number {
  const usage = toUsage(u)
  return (
    usageField(usage, 'inputTokens') +
    usageField(usage, 'cacheCreationTokens') +
    usageField(usage, 'cacheReadTokens') +
    usageField(usage, 'outputTokens')
  )
}

/**
 * 缓存命中率 = 缓存读 / (输入 + 缓存读)。
 *
 * 分母为 0（既没有直连输入也没有缓存读）时返回 0；结果夹在 [0, 1]，
 * 脏数据造出越界比值时也不会破坏这个承诺。
 */
export function cacheHitRate(u: TokenUsage): number {
  const usage = toUsage(u)
  const cacheRead = usageField(usage, 'cacheReadTokens')
  const denominator = usageField(usage, 'inputTokens') + cacheRead
  if (denominator <= 0) {
    return 0
  }
  const rate = cacheRead / denominator
  return Math.min(1, Math.max(0, rate))
}

/** 返回一份全新的全 0 成本 */
export function zeroCost(): CostBreakdown {
  return { ...ZERO_COST }
}

/**
 * 两份成本相加，返回新对象。
 *
 * `totalCost` 由四个分项重新相加得出，而不是累加各自的 totalCost，
 * 这样即使某一条的分项与总数自相矛盾，汇总结果仍然自洽。
 */
export function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  const left = toCost(a)
  const right = toCost(b)
  const inputCost = costPart(left.inputCost) + costPart(right.inputCost)
  const outputCost = costPart(left.outputCost) + costPart(right.outputCost)
  const cacheWriteCost = costPart(left.cacheWriteCost) + costPart(right.cacheWriteCost)
  const cacheReadCost = costPart(left.cacheReadCost) + costPart(right.cacheReadCost)
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
    currency: 'USD',
    // 任一侧带标记位，汇总结果就带：下游只需要知道「这批数据里有估算成分」
    unpricedModel: left.unpricedModel === true || right.unpricedModel === true,
    isEstimated: left.isEstimated === true || right.isEstimated === true,
  }
}

/**
 * 计算一次调用的成本，带完整兜底。
 *
 * 这是 stats 与成本引擎之间唯一的接缝，因此 `calculator` 必须当成不可信边界：
 * 不传、抛错、返回非对象，一律退到全 0 成本并标记 unpricedModel——绝不让整张
 * 报表因为一个坏计算器而算不出来，也绝不让"算不出来"伪装成"不要钱"。
 * `totalCost` 同样由分项重算，不信任入参的总量字段。
 *
 * 计算器返回的对象即使缺字段也按缺省值处理（标记位缺省 false）：真实场景里
 * 计算器总是返回完整结构，缺字段属于罕见故障，宽容处理可以避免误报"无价目"。
 * 真正需要提示"无法定价"的路径是：未装配计算器、计算器抛错、计算器返回非对象，
 * 以及 costOf 遇到价目表里没有的模型——这四条都已覆盖。
 *
 * @param usage - 本次调用的 token 用量
 * @param model - 模型 ID；空串表示记录里没有模型信息
 * @param calculator - 集成层注入的成本计算器；null 表示未装配
 */
export function calculateCost(
  usage: TokenUsage,
  model: string,
  calculator: CostCalculator | null,
): CostBreakdown {
  if (calculator === null) {
    return { ...ZERO_COST, unpricedModel: true }
  }

  let result: unknown
  try {
    result = calculator(usage, model)
  } catch {
    return { ...ZERO_COST, unpricedModel: true }
  }

  if (!isPlainObject(result)) {
    // 计算器返回了非对象：同样是"算不出来"，标记为无法定价
    return { ...ZERO_COST, unpricedModel: true }
  }

  const inputCost = costPart(result.inputCost)
  const outputCost = costPart(result.outputCost)
  const cacheWriteCost = costPart(result.cacheWriteCost)
  const cacheReadCost = costPart(result.cacheReadCost)
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
    currency: 'USD',
    // 透传计算器的标记位，让"这个模型没价目"一路传到展示层
    unpricedModel: result.unpricedModel === true,
    isEstimated: result.isEstimated === true,
  }
}
