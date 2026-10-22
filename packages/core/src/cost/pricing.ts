/**
 * 模型价目表与价格查询（docs/PRICING.md §1 / §4）
 *
 * 单位统一为 **美元 / 百万 token（$/MTok）**。
 *
 * 冻结的 `ModelPricing` 只有 input/output/cacheWrite/cacheRead 四个字段，
 * 因此表中 `cacheWrite` 存的是 **5m 价**（= 输入价 × 1.25）；
 * **1h 价**（= 输入价 × 2.0）由消费方按常量推导，不在表内重复存一份，
 * 避免两份数字漂移。Fast 价同理单独放一张表。
 */

import { normalizeModelId } from './normalize.js'
import type { PriceLookup } from './types.js'
import type { ModelPricing } from '../types.js'

/**
 * 完整价目表（PRICING.md §1 的 13 个模型，顺序与文档一致）。
 *
 * cacheRead 列是官方特价，不全部遵循「输入价 × 0.1」，
 * 因此必须逐行录入而不是推导。
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
})

/**
 * Fast 模式单价（PRICING.md §1 最后两列），只覆盖支持 fast 的三个 Opus 模型。
 *
 * 缓存写在 fast 模式下不涨价，因此这里只需要 input/output。
 */
export const FAST_PRICING: Readonly<Record<string, { input: number; output: number }>> =
  Object.freeze({
    'claude-opus-5-5': { input: 8, output: 40 },
    'claude-opus-5': { input: 10, output: 50 },
    'claude-opus-4-8': { input: 10, output: 50 },
  })

/**
 * 从查找表里读一项。
 *
 * 用 Map 而不是裸对象下标：`record['toString']` 会命中原型链上的函数，
 * 把脏模型 ID 当成合法价格。Map 没有原型污染问题，查找仍是 O(1)。
 */
function readEntry<T>(table: ReadonlyMap<string, T>, key: string): T | null {
  const entry = table.get(key)
  return entry === undefined ? null : entry
}

/** MODEL_PRICING 的查找视图，键已归一化 */
const PRICING_BY_MODEL_ID: ReadonlyMap<string, ModelPricing> = new Map(
  Object.entries(MODEL_PRICING),
)

/** FAST_PRICING 的查找视图 */
const FAST_PRICING_BY_MODEL_ID: ReadonlyMap<string, { input: number; output: number }> = new Map(
  Object.entries(FAST_PRICING),
)

/**
 * 查询模型的标准价。
 *
 * @param model - 原始模型 ID（带前缀/日期后缀也可以，内部会先归一化）
 * @returns 命中时 `pricing` 非 null 且 `isEstimated` 为 false；
 *          未命中时 `pricing` 为 null 且 `isEstimated` 为 true（PRICING.md §2.4）
 */
export function priceFor(model: string): PriceLookup {
  const normalizedModel = normalizeModelId(model)
  const pricing = readEntry(PRICING_BY_MODEL_ID, normalizedModel)
  return { pricing, normalizedModel, isEstimated: pricing === null }
}

/**
 * 查询模型的 fast 价。
 *
 * @param model - 原始或已归一化的模型 ID（归一化是幂等的，重复执行无副作用）
 * @returns 该模型支持 fast 时返回单价，否则返回 null
 */
export function fastPriceFor(model: string): { input: number; output: number } | null {
  return readEntry(FAST_PRICING_BY_MODEL_ID, normalizeModelId(model))
}

/**
 * 价目表中的全部模型 ID，顺序与 PRICING.md §1 表格一致。
 *
 * @returns 每次调用都返回新数组，调用方排序/过滤不会影响表本身
 */
export function allModelIds(): readonly string[] {
  return Object.keys(MODEL_PRICING)
}
