import type { TimeBucket, UsageQuery } from '../types/api'
import { totalTokens } from './chartData'

export type Period = 'day' | 'week' | 'month'
const DAY_MS = 86400000

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Inputs are calendar dates in UTC, with an inclusive end date in the UI. */
export function dateBounds(start: string, end: string): Pick<UsageQuery, 'since' | 'until'> | null {
  for (const date of [start, end]) {
    if (
      date !== '' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        isoDay(new Date(date)) !== date)
    )
      {return null}
  }
  if (start !== '' && end !== '' && start > end) return null
  return {
    ...(start === '' ? {} : { since: new Date(start).toISOString() }),
    ...(end === '' ? {} : { until: new Date(Date.parse(end) + DAY_MS).toISOString() }),
  }
}

export function usageSearch(query: UsageQuery): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    {if (typeof value === 'string') search.set(key, value)}
  return search.toString()
}

export function periodRows(days: readonly TimeBucket[], period: Period) {
  const rows = new Map<string, { period: string; cost: number; tokens: number; requests: number }>()
  for (const day of days) {
    const date = new Date(`${day.bucket}T00:00:00Z`)
    if (period === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    const key = period === 'month' ? day.bucket.slice(0, 7) : isoDay(date)
    const row = rows.get(key) ?? { period: key, cost: 0, tokens: 0, requests: 0 }
    row.cost += day.cost.totalCost
    row.tokens += totalTokens(day.usage)
    row.requests += day.requestCount
    rows.set(key, row)
  }
  return [...rows.values()].toSorted((a, b) => b.period.localeCompare(a.period))
}

export function heatmapDays(days: readonly TimeBucket[], end: string, count = 91) {
  const byDay = new Map(days.map((day) => [day.bucket, day.requestCount]))
  const size = Math.min(366, Math.max(1, count))
  return Array.from({ length: size }, (_, index) => {
    const day = isoDay(new Date(Date.parse(end) - (size - index - 1) * DAY_MS))
    return { day, requests: byDay.get(day) ?? 0 }
  })
}
