/**
 * @turnflare/core —— 时间分桶
 *
 * timestamp 一律是 UTC ISO 串（ARCHITECTURE.md §1.2 坑 4）。分桶前先按时区
 * 偏移把 UTC 毫秒平移到"本地时间"，再对齐到整点 / 当天，这样 UTC+8 的用户
 * 看到的"今天"才是他日历上的今天，而不是 UTC 的今天。
 *
 * 只返回有数据的桶：没有活动的时段不补零，补零是展示层的事。
 */

import type { CostBreakdown, TimeBucket, TokenUsage, Turn } from '../types.js'
import type { BucketGranularity, CostCalculator } from './types.js'
import { addCost, addUsage, calculateCost, emptyUsage, zeroCost } from './usage.js'
import { isPlainObject, isPresent, readFiniteNumber, readString } from './narrow.js'

/** 1 分钟的毫秒数：时区偏移换算 */
const MS_PER_MINUTE = 60_000

/**
 * 真实时区偏移的极值（UTC-12 ~ UTC+14）。
 *
 * 超出范围的偏移量一律夹到边界：脏偏移量会把日期平移到公元 275760 年，
 * 那种桶键没有任何展示价值，还会让排序失去意义。
 */
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60

const HOUR_GRANULARITY: BucketGranularity = { kind: 'hour' }
const DAY_GRANULARITY: BucketGranularity = { kind: 'day' }

/** 单个桶的累加器；每次更新都整体替换成新对象，绝不在原对象上改字段 */
interface BucketAccumulator {
  readonly usage: TokenUsage
  readonly cost: CostBreakdown
  readonly requestCount: number
}

/**
 * 解析时间戳为 epoch 毫秒。
 *
 * 空串、非字符串、无法解析都返回 null —— 调用方应跳过这些 turn，
 * 而不是把它们塞进某个桶里凑数。
 */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * 按小时分桶。
 *
 * @param turns - 待分桶的 turn；没有 usage 或时间戳不可解析的会被跳过
 * @param timezoneOffsetMinutes - 时区偏移分钟数，默认 0（UTC）
 * @param costCalculator - 成本计算器；不传时桶内成本全 0
 * @returns 按时间升序的桶数组，只包含有数据的桶
 */
export function bucketByHour(
  turns: readonly Turn[],
  timezoneOffsetMinutes?: number,
  costCalculator?: CostCalculator | null,
): readonly TimeBucket[] {
  return bucketTurns(turns, HOUR_GRANULARITY, timezoneOffsetMinutes, costCalculator)
}

/**
 * 按天分桶（本地日期）。
 *
 * @param turns - 待分桶的 turn；没有 usage 或时间戳不可解析的会被跳过
 * @param timezoneOffsetMinutes - 时区偏移分钟数，默认 0（UTC）
 * @param costCalculator - 成本计算器；不传时桶内成本全 0
 * @returns 按日期升序的桶数组，只包含有数据的桶
 */
export function bucketByDay(
  turns: readonly Turn[],
  timezoneOffsetMinutes?: number,
  costCalculator?: CostCalculator | null,
): readonly TimeBucket[] {
  return bucketTurns(turns, DAY_GRANULARITY, timezoneOffsetMinutes, costCalculator)
}

function bucketTurns(
  turns: readonly Turn[],
  granularity: BucketGranularity,
  timezoneOffsetMinutes: number | undefined,
  costCalculator: CostCalculator | null | undefined,
): readonly TimeBucket[] {
  const offsetMinutes = toTimezoneOffset(timezoneOffsetMinutes)
  const accumulators = new Map<string, BucketAccumulator>()
  for (const turn of turns) {
    accumulate(accumulators, turn, granularity, offsetMinutes, costCalculator ?? null)
  }
  return [...accumulators.entries()]
    .sort(([left], [right]) => compareBucketKeys(left, right))
    .map(([bucket, accumulator]) => ({
      bucket,
      usage: accumulator.usage,
      cost: accumulator.cost,
      requestCount: accumulator.requestCount,
    }))
}

function accumulate(
  accumulators: Map<string, BucketAccumulator>,
  turn: Turn,
  granularity: BucketGranularity,
  offsetMinutes: number,
  costCalculator: CostCalculator | null,
): void {
  if (!isPlainObject(turn) || !isPresent(turn.usage)) {
    return
  }
  const timestampMs = parseTimestamp(turn.timestamp)
  if (timestampMs === null) {
    return
  }
  const local = toLocalDate(timestampMs, offsetMinutes)
  if (local === null) {
    return
  }

  const key = toBucketKey(local, granularity)
  const previous = accumulators.get(key)
  accumulators.set(key, {
    usage: addUsage(previous?.usage ?? emptyUsage(), turn.usage),
    cost: addCost(
      previous?.cost ?? zeroCost(),
      calculateCost(turn.usage, modelOf(turn), costCalculator),
    ),
    requestCount: (previous?.requestCount ?? 0) + 1,
  })
}

/** model 为 null 时传空串：成本表查不到就是查不到，绝不拿别的模型价格猜 */
function modelOf(turn: Turn): string {
  return readString(turn.model)
}

/** 时区偏移夹紧到真实世界范围；非有限数按 0（UTC）处理 */
function toTimezoneOffset(value: number | undefined): number {
  const offset = readFiniteNumber(value)
  if (offset === null) {
    return 0
  }
  return Math.min(MAX_TIMEZONE_OFFSET_MINUTES, Math.max(-MAX_TIMEZONE_OFFSET_MINUTES, offset))
}

/** 把 UTC 毫秒平移到本地时区；结果超出 Date 可表示范围时返回 null */
function toLocalDate(utcMs: number, offsetMinutes: number): Date | null {
  const shifted = new Date(utcMs + offsetMinutes * MS_PER_MINUTE)
  return Number.isNaN(shifted.getTime()) ? null : shifted
}

/**
 * 生成桶键。
 *
 * 小时粒度对齐到整点并带 `Z`（与 jsonl 的 UTC 时间戳同一套词汇），
 * 天粒度取本地日期。两种键都是定宽字符串，字典序即时间序。
 */
function toBucketKey(local: Date, granularity: BucketGranularity): string {
  const year = pad(local.getUTCFullYear(), 4)
  const month = pad(local.getUTCMonth() + 1, 2)
  const day = pad(local.getUTCDate(), 2)
  if (granularity.kind === 'day') {
    return `${year}-${month}-${day}`
  }
  return `${year}-${month}-${day}T${pad(local.getUTCHours(), 2)}:00:00Z`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function compareBucketKeys(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}
