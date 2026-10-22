import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalyticsPayload } from '../types/api'
import { AnalyticsPage } from './AnalyticsPage'
import {
  envelope,
  makeCost,
  makeModelStats,
  makeOverview,
  makeProjectStats,
  makeTimeBucket,
} from '../test/fixtures'
import { jsonResponse, stubFetch } from '../test/fetchStub'

function data(): AnalyticsPayload {
  return {
    ...makeOverview(),
    filters: { chain: 'main' },
    requestCount: 7,
    cost: makeCost({ totalCost: 95 }),
    models: [makeModelStats()],
    projects: [makeProjectStats()],
    days: [makeTimeBucket({ bucket: '2026-10-19' })],
    tools: [{ toolName: 'Read', callCount: 10, errorCount: 2, totalResultBytes: 1024 }],
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('filters one analytics cohort, groups periods, drills into heatmap days and saves a personal budget', async () => {
  const fetcher = stubFetch((url) =>
    url.startsWith('/api/stats/analytics')
      ? jsonResponse(
          envelope(
            url.endsWith('/options')
              ? { projects: ['demo-project'], models: ['claude-sonnet-4-5-20250929'] }
              : data(),
          ),
        )
      : undefined,
  )
  render(<AnalyticsPage />)
  await screen.findByText('工具排行')
  expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
  expect(screen.getByText('20.0%')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('统计范围'), { target: { value: 'side' } })
  fireEvent.change(screen.getByLabelText('模型'), {
    target: { value: 'claude-sonnet-4-5-20250929' },
  })
  fireEvent.change(screen.getByLabelText('项目'), { target: { value: 'demo-project' } })
  await waitFor(() =>
    expect(
      fetcher.calls.some(
        ({ url }) =>
          String(url).includes('chain=side') &&
          String(url).includes('model=claude-sonnet') &&
          String(url).includes('project=demo-project'),
      ),
    ).toBe(true),
  )
  fireEvent.change(screen.getByLabelText('统计周期'), { target: { value: 'week' } })
  expect(screen.getByText('2026-10-19')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('统计周期'), { target: { value: 'month' } })
  expect(screen.getByText('2026-10')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '2026-10-19 · 4 请求' }))
  await waitFor(() =>
    expect(
      fetcher.calls.some(
        ({ url }) =>
          String(url).includes('since=2026-10-19') && String(url).includes('until=2026-10-20'),
      ),
    ).toBe(true),
  )
  fireEvent.change(screen.getByLabelText('所选范围预算（USD）'), { target: { value: '100' } })
  expect(screen.getByText('即将达到自设预算')).toBeInTheDocument()
  expect(localStorage.getItem('turnflare-range-budget')).toBe('100')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }))
  })
  expect(screen.getByLabelText('开始日期（UTC）')).toHaveValue('')
})

it('rejects reversed dates and disables exporting a different cohort', async () => {
  stubFetch((url) =>
    url.startsWith('/api/stats/analytics')
      ? jsonResponse(
          envelope(
            url.endsWith('/options')
              ? { projects: ['demo-project'], models: ['claude-sonnet-4-5-20250929'] }
              : data(),
          ),
        )
      : undefined,
  )
  render(<AnalyticsPage />)
  await screen.findByText('工具排行')
  await act(async () => {
    fireEvent.change(screen.getByLabelText('开始日期（UTC）'), { target: { value: '2026-10-22' } })
    fireEvent.change(screen.getByLabelText('结束日期（含当天）'), {
      target: { value: '2026-10-19' },
    })
  })
  expect(screen.getByRole('alert')).toHaveTextContent('请填写有效的日期范围')
  expect(screen.getByRole('button', { name: '导出当前筛选' })).toBeDisabled()
  await waitFor(() => expect(screen.getByRole('button', { name: '导出当前筛选' })).toBeDisabled())
})

it('reports empty filtered activity without hiding controls', async () => {
  stubFetch((url) =>
    url.startsWith('/api/stats/analytics')
      ? jsonResponse(
          envelope(
            url.endsWith('/options')
              ? { projects: [], models: [] }
              : { ...data(), turnCount: 0, tools: [] },
          ),
        )
      : undefined,
  )
  render(<AnalyticsPage />)
  expect(await screen.findByText('当前筛选没有活动，请调整筛选条件')).toBeInTheDocument()
  expect(screen.getByText('该范围没有工具调用')).toBeInTheDocument()
})
