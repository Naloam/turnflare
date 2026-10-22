import { t } from './locale'
/**
 * 前端格式化工具。
 *
 * 刻意重复（intentional duplication）：
 * 这里的实现与 `@turnflare/core` 的 `src/format/*` 行为完全一致，但**不能**直接从 core 导入——
 * core 依赖 `node:fs` 等 Node 内置模块，打进浏览器包会直接构建失败。
 * 因此 web 侧维护一份等价实现，两侧行为分别由各自的测试锁定。
 *
 * 修改任一侧必须同步另一侧，否则前端展示与 CLI/报告会出现同数不同形的问题。
 */

const NOT_AVAILABLE = '-'

/** 对外暴露的「无数据」占位符，便于页面与图表在缺字段时保持同一套视觉语言 */
export const UNAVAILABLE_TEXT = NOT_AVAILABLE

const THOUSAND = 1_000
const MILLION = 1_000_000
const BILLION = 1_000_000_000

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** 相对时间超过该天数后改为展示绝对日期 */
const RELATIVE_DATE_THRESHOLD_DAYS = 7

/** 有效数字位数：足够抹掉二进制浮点的表示噪声，又不影响正常量级的数值 */
const PRECISION_DIGITS = 15

/** 小于该阈值的金额展示 4 位小数，否则 2 位 */
const SMALL_AMOUNT_THRESHOLD = 0.01

const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * 1024
const BYTES_PER_GB = BYTES_PER_MB * 1024

/** 本地时间分量（已按调用方给定的时区偏移平移） */
interface TimeParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 千分位分组（仅整数部分） */
function groupThousands(digits: string): string {
  const parts: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3)
    parts.unshift(digits.slice(start, end))
  }
  return parts.join(',')
}

/** 保留一位小数，但整数值不带小数点（40 -> "40"，40.25 -> "40.3"） */
function formatOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** 把 ISO 字符串转成 epoch 毫秒；非法输入返回 null */
function toEpochMs(iso: string): number | null {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

/** 按给定分钟偏移取本地时间分量 */
function shiftParts(epochMs: number, offsetMinutes: number): TimeParts {
  const shifted = new Date(epochMs + offsetMinutes * MS_PER_MINUTE)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/**
 * 浏览器本地时区偏移（分钟），可直接传给本模块其余函数的 `timezoneOffsetMinutes` 参数。
 *
 * `Date.prototype.getTimezoneOffset()` 的语义是「本地时间加上多少分钟等于 UTC」，
 * 而本模块的偏移参数语义是「UTC 加上多少分钟等于展示时间」，两者符号相反，故取负。
 */
export function localTimezoneOffsetMinutes(now: Date = new Date()): number {
  const offset = now.getTimezoneOffset()
  // 取负会得到 -0，而 -0 参与除法会产出 -Infinity；显式归一成 +0
  return offset === 0 ? 0 : -offset
}

/** token 紧凑格式：40198 -> "40.2K"，1500000 -> "1.5M"，999 -> "999"。非有限值返回 "-"。 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(count)
  const sign = count < 0 ? '-' : ''

  if (absolute < THOUSAND) {
    return sign + String(Math.trunc(absolute))
  }
  if (absolute < MILLION) {
    return sign + formatOneDecimal(absolute / THOUSAND) + 'K'
  }
  if (absolute < BILLION) {
    return sign + formatOneDecimal(absolute / MILLION) + 'M'
  }
  return sign + formatOneDecimal(absolute / BILLION) + 'B'
}

/** token 精确格式：40198 -> "40,198"。小数部分被截断而非四舍五入。非有限值返回 "-"。 */
export function formatTokensDetailed(count: number): string {
  if (!Number.isFinite(count)) {
    return NOT_AVAILABLE
  }
  const truncated = Math.trunc(count)
  const sign = truncated < 0 ? '-' : ''
  return sign + groupThousands(String(Math.abs(truncated)))
}

/** 金额：1.2345 -> "$1.23"，0.004 -> "$0.0040"，1234.5 -> "$1,234.50"。非有限值返回 "-"。 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) {
    return NOT_AVAILABLE
  }

  const absolute = Math.abs(usd)
  const sign = usd < 0 ? '-' : ''
  const isSmall = absolute > 0 && absolute < SMALL_AMOUNT_THRESHOLD
  const fixed = absolute.toFixed(isSmall ? 4 : 2)
  const [integerPart = '0', fractionPart = ''] = fixed.split('.')

  const grouped = groupThousands(integerPart)
  const withFraction = fractionPart.length > 0 ? `${grouped}.${fractionPart}` : grouped
  return `${sign}$${withFraction}`
}

/**
 * 百分比：0.8765 -> "87.7%"（默认 1 位），1 -> "100.0%"。非有限值返回 "-"。
 *
 * 必须先清洗浮点噪声再舍入：0.8765 * 100 在二进制下实际是 87.64999999999999，
 * 直接 toFixed(1) 会得到 "87.6%"，而数学上的四舍五入结果应为 "87.7%"。
 */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) {
    return NOT_AVAILABLE
  }
  const percent = Number((ratio * 100).toPrecision(PRECISION_DIGITS))
  return `${percent.toFixed(fractionDigits)}%`
}

/** 字节数：1536 -> "1.5 KB"，1048576 -> "1.0 MB"。负数与非有限值返回 "-"。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return NOT_AVAILABLE
  }
  if (bytes < BYTES_PER_KB) {
    return `${Math.trunc(bytes)} B`
  }
  if (bytes < BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`
  }
  if (bytes < BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`
  }
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`
}

/** 中文相对时间：3 分钟前 / 2 小时前 / 昨天 / 3 天前 / 2026-10-01。非法输入返回 "-"。 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const target = toEpochMs(iso)
  if (target === null) {
    return NOT_AVAILABLE
  }

  const deltaMs = now.getTime() - target
  const future = deltaMs < 0
  const absoluteDelta = Math.abs(deltaMs)

  if (absoluteDelta < MS_PER_MINUTE) {
    return t('刚刚')
  }
  if (absoluteDelta < MS_PER_HOUR) {
    const minutes = Math.floor(absoluteDelta / MS_PER_MINUTE)
    return t(future ? '{n} 分钟后' : '{n} 分钟前', { n: minutes })
  }
  if (absoluteDelta < MS_PER_DAY) {
    const hours = Math.floor(absoluteDelta / MS_PER_HOUR)
    return t(future ? '{n} 小时后' : '{n} 小时前', { n: hours })
  }

  const days = Math.floor(absoluteDelta / MS_PER_DAY)
  if (days >= RELATIVE_DATE_THRESHOLD_DAYS) {
    // 超过阈值就退化成绝对日期。这里必须走本地时区而不是写死 0（UTC）：
    // 同一块屏幕上的其它日期都用本地偏移，只有一个用 UTC 会让同一个时刻
    // 在一张卡片里显示出两个不同的日子。
    return localDate(iso)
  }
  if (days === 1) {
    return t(future ? '明天' : '昨天')
  }
  return t(future ? '{n} 天后' : '{n} 天前', { n: days })
}

/** 本地日期（DST 安全）。非法输入返回 "-"。 */
export function localDate(iso: string): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs))
  const field = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? NOT_AVAILABLE
  return `${field('year')}-${field('month')}-${field('day')}`
}

/** 本地日期时间：2026-10-19 16:25。非法输入返回 "-"。 */
export function formatDateTime(iso: string, timezoneOffsetMinutes = 0): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = shiftParts(epochMs, timezoneOffsetMinutes)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

/**
 * 按浏览器本地时区格式化，**DST 安全**。
 *
 * 与 formatDateTime(iso, offset) 的分工：后者要一个固定分钟偏移，而
 * localTimezoneOffsetMinutes() 只能给出**当前时刻**的偏移。把它套到几个月前的
 * 时间戳上，遇到夏令时切换就会差一小时——7 月的 EDT 是 -240，11 月的 EST 是
 * -300，拿 11 月的偏移渲染 7 月的时刻，结果就偏离真实墙钟一小时。
 *
 * Intl 的 timeZone 缺省取系统时区，并且对每个瞬间各自判断 DST，所以"把某个
 * 时刻显示成本地时间"必须走 Intl，不能自己加一个固定偏移。
 *
 * 用 hourCycle 而不是 hour12：后者在某些 locale 下会把午夜渲染成 24 点。
 */
export function formatLocalDateTime(iso: string): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs))
  const field = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? NOT_AVAILABLE
  return `${field('year')}-${field('month')}-${field('day')} ${field('hour')}:${field('minute')}`
}

/** 本地日期：2026-10-19。非法输入返回 "-"。 */
export function formatDate(iso: string, timezoneOffsetMinutes = 0): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = shiftParts(epochMs, timezoneOffsetMinutes)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}
