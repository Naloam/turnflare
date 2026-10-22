import { describe, expect, it } from 'vitest'
import { dateBounds, periodRows, heatmapDays } from './analytics'

describe('UTC analytics periods', () => {
  it('includes the selected end date and rejects reversed or invalid dates', () => {
    expect(dateBounds('2026-10-19', '2026-10-20')).toEqual({
      since: '2026-10-19T00:00:00.000Z',
      until: '2026-10-21T00:00:00.000Z',
    })
    expect(dateBounds('2026-10-21', '2026-10-20')).toBeNull()
    expect(dateBounds('2026-02-30', '')).toBeNull()
  })
  it('uses Monday weeks across years and fills empty heatmap days with a bounded grid', () => {
    const usage = {
      speed: 'standard' as const,
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    }
    const cost = {
      currency: 'USD' as const,
      totalCost: 1,
      inputCost: 1,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      unpricedModel: false,
      isEstimated: false,
    }
    const days = ['2026-12-31', '2027-01-01'].map((bucket) => ({
      bucket,
      usage,
      cost,
      requestCount: 1,
    }))
    expect(periodRows(days, 'week')).toEqual([
      { period: '2026-12-28', cost: 2, tokens: 240, requests: 2 },
    ])
    expect(periodRows(days, 'month')).toHaveLength(2)
    expect(heatmapDays(days, '2027-01-02', 3).map((d) => d.requests)).toEqual([1, 1, 0])
    expect(heatmapDays([], '2027-01-02', 10000)).toHaveLength(366)
  })
})
