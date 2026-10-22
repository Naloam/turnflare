import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OverviewPage } from './OverviewPage'
import {
  envelope,
  makeCost,
  makeModelStats,
  makeOverview,
  makeProjectStats,
  makeSidechain,
  makeTimeBucket,
  makeUsage,
} from '../test/fixtures'
import { jsonResponse, stubFetch } from '../test/fetchStub'

function stubOverview(payload: ReturnType<typeof makeOverview>, status = 200) {
  return stubFetch((url) =>
    url === '/api/stats/overview' ? jsonResponse(envelope(payload), status) : undefined,
  )
}

beforeEach(() => {
  window.location.hash = '#/overview'
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('OverviewPage', () => {
  test('zero indexed sessions shows onboarding instead of empty charts', async () => {
    stubOverview(makeOverview({ sessionCount: 0 }))
    render(<OverviewPage />)
    expect(await screen.findByText('还没有统计数据')).toBeInTheDocument()
    expect(screen.queryByTestId('kpi-card')).not.toBeInTheDocument()
  })
  test('加载中显示骨架', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    render(<OverviewPage />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByTestId('kpi-card')).not.toBeInTheDocument()
  })

  test('渲染四张 KPI 卡片', async () => {
    stubOverview(
      makeOverview({
        sessionCount: 7,
        turnCount: 128,
        cacheHitRate: 0.4237,
        cost: makeCost({ totalCost: 12.5, isEstimated: false }),
        usage: {
          speed: 'standard',
          inputTokens: 1000,
          cacheCreationTokens: 200,
          cacheReadTokens: 300,
          outputTokens: 400,
          thinkingTokens: 0,
          serverToolUse: 0,
        },
        byProject: [makeProjectStats(), makeProjectStats({ projectSlug: 'other' })],
      }),
    )

    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })

    const cards = screen
      .getAllByTestId('kpi-card')
      .map((card) => card.textContent)
      .join('|')
    expect(cards).toContain('总 Token')
    expect(cards).toContain('1.9K')
    expect(cards).toContain('总成本')
    expect(cards).toContain('$12.50')
    expect(cards).toContain('会话数')
    expect(cards).toContain('7')
    expect(cards).toContain('缓存命中率')
    expect(cards).toContain('42.4%')
  })

  test('estimated 成本在副标题里说明', async () => {
    stubOverview(makeOverview({ cost: makeCost({ totalCost: 1, isEstimated: true }) }))
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByText('含估算价目')).toBeInTheDocument()
    })
  })

  test('unpricedModel 为 true 时显示醒目提示', async () => {
    stubOverview(makeOverview({ cost: makeCost({ unpricedModel: true }) }))
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByTestId('unpriced-warning')).toBeInTheDocument()
    })
    expect(screen.getByText('部分模型无价目数据，成本未计入')).toBeInTheDocument()
  })

  test('unpricedModel 为 false 时不显示提示', async () => {
    stubOverview(makeOverview({ cost: makeCost({ unpricedModel: false }) }))
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })
    expect(screen.queryByTestId('unpriced-warning')).not.toBeInTheDocument()
  })

  test('有侧链活动时提示条说明它未计入主对话统计', async () => {
    // Arrange：侧链数字按规格里的真实量级给，顺带锁定格式化口径
    stubOverview(
      makeOverview({
        sidechain: makeSidechain({
          turnCount: 24378,
          usage: makeUsage({
            inputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 459_194_800,
          }),
          requestCount: 1986,
        }),
      }),
    )

    // Act
    render(<OverviewPage />)

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('sidechain-notice')).toBeInTheDocument()
    })
    const notice = screen.getByTestId('sidechain-notice')
    expect(notice.textContent).toContain('subagent 活动')
    expect(notice.textContent).toContain('24,378 个 turn')
    expect(notice.textContent).toContain('459.2M token')
    expect(notice.textContent).toContain('未计入主对话统计')
  })

  test('没有侧链活动时不渲染提示条', async () => {
    // Arrange
    stubOverview(makeOverview({ sidechain: makeSidechain({ turnCount: 0 }) }))

    // Act
    render(<OverviewPage />)

    // Assert
    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })
    expect(screen.queryByTestId('sidechain-notice')).not.toBeInTheDocument()
  })

  test('渲染成本趋势与模型占比两个分区', async () => {
    stubOverview(
      makeOverview({
        byDay: [makeTimeBucket({ bucket: '2026-10-18T00:00:00Z' })],
        byModel: [makeModelStats({ model: 'claude-opus-4-1-20250805' })],
      }),
    )
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '成本趋势' })).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: '模型占比' })).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-1')).toBeInTheDocument()
  })

  test('请求失败显示错误态', async () => {
    stubOverview(makeOverview({}), 500)
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('请求失败（HTTP 500）')).toBeInTheDocument()
    expect(screen.queryByTestId('kpi-card')).not.toBeInTheDocument()
  })

  test('服务端 success=false 时透出中文错误', async () => {
    stubFetch(() => jsonResponse({ success: false, data: null, error: '数据库未初始化' }))
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByText('数据库未初始化')).toBeInTheDocument()
    })
  })

  test('空数据显示引导空态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: null, error: null }),
        }),
      ),
    )
    render(<OverviewPage />)

    await waitFor(() => {
      expect(screen.getByText('还没有统计数据')).toBeInTheDocument()
    })
  })
})
