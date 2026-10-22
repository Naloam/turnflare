/**
 * 时间与时长格式化。
 *
 * timestamp 一律按 UTC ISO 字符串接收；展示层按调用方给定的时区偏移换算。
 */

const NOT_AVAILABLE = '-'

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** 相对时间超过该天数后改为展示绝对日期 */
const RELATIVE_DATE_THRESHOLD_DAYS = 7

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把 ISO 字符串转成 epoch 毫秒；非法输入返回 null */
function toEpochMs(iso: string): number | null {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

/** 按给定分钟偏移取本地时间分量 */
function shiftParts(epochMs: number, offsetMinutes: number) {
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
 * 人类可读时长：45000 -> "45s"，90000 -> "1m 30s"，3600000 -> "1h 0m"。
 * 超过 24 小时显示 "2d 3h"；负数与非有限值返回 "-"。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return NOT_AVAILABLE
  }

  if (ms < MS_PER_MINUTE) {
    return `${Math.floor(ms / MS_PER_SECOND)}s`
  }
  if (ms < MS_PER_HOUR) {
    const minutes = Math.floor(ms / MS_PER_MINUTE)
    const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND)
    return `${minutes}m ${seconds}s`
  }
  if (ms < MS_PER_DAY) {
    const hours = Math.floor(ms / MS_PER_HOUR)
    const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)
    return `${hours}h ${minutes}m`
  }

  const days = Math.floor(ms / MS_PER_DAY)
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR)
  return `${days}d ${hours}h`
}

/** 紧凑时长：90000 -> "1:30"，3661000 -> "1:01:01" */
export function formatDurationPrecise(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return NOT_AVAILABLE
  }

  const totalSeconds = Math.floor(ms / MS_PER_SECOND)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  }
  return `${minutes}:${pad2(seconds)}`
}

/** 中文相对时间：3 分钟前 / 2 小时前 / 昨天 / 3 天前 / 2026-10-01 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const target = toEpochMs(iso)
  if (target === null) {
    return NOT_AVAILABLE
  }

  const deltaMs = now.getTime() - target
  const future = deltaMs < 0
  const absoluteDelta = Math.abs(deltaMs)

  if (absoluteDelta < MS_PER_MINUTE) {
    return '刚刚'
  }
  if (absoluteDelta < MS_PER_HOUR) {
    const minutes = Math.floor(absoluteDelta / MS_PER_MINUTE)
    return future ? `${minutes} 分钟后` : `${minutes} 分钟前`
  }
  if (absoluteDelta < MS_PER_DAY) {
    const hours = Math.floor(absoluteDelta / MS_PER_HOUR)
    return future ? `${hours} 小时后` : `${hours} 小时前`
  }

  const days = Math.floor(absoluteDelta / MS_PER_DAY)
  if (days >= RELATIVE_DATE_THRESHOLD_DAYS) {
    return formatDate(iso, 0)
  }
  if (days === 1) {
    return future ? '明天' : '昨天'
  }
  return future ? `${days} 天后` : `${days} 天前`
}

/** 本地日期时间：2026-10-19 16:25 */
export function formatDateTime(iso: string, timezoneOffsetMinutes = 0): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = shiftParts(epochMs, timezoneOffsetMinutes)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

/** 本地日期：2026-10-19 */
export function formatDate(iso: string, timezoneOffsetMinutes = 0): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = shiftParts(epochMs, timezoneOffsetMinutes)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

/** 本地小时桶键：2026-10-19T16:00:00Z（对齐到整点） */
export function formatHourBucket(iso: string, timezoneOffsetMinutes = 0): string {
  const epochMs = toEpochMs(iso)
  if (epochMs === null) {
    return NOT_AVAILABLE
  }
  const parts = shiftParts(epochMs, timezoneOffsetMinutes)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:00:00Z`
}
