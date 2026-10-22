import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SessionDetailPage } from './SessionDetailPage'
import {
  envelope,
  makeCost,
  makeSessionDetail,
  makeTool,
  makeTurn,
  makeUsage,
} from '../test/fixtures'
import { jsonResponse, stubFetch } from '../test/fetchStub'

const DETAIL = makeSessionDetail({
  sessionId: 'session-abc',
  projectSlug: 'demo-project',
  cwd: '/Users/demo/work',
  gitBranch: 'feature/login',
  startedAt: '2026-10-19T08:00:00.000Z',
  endedAt: '2026-10-19T09:30:00.000Z',
  parseErrorCount: 2,
  turns: [
    makeTurn({ uuid: 'u1', role: 'user', usage: null, textPreview: '帮我看看' }),
    makeTurn({
      uuid: 'a1',
      role: 'assistant',
      textPreview: '好的，我来处理',
      usage: makeUsage({
        inputTokens: 1200,
        cacheCreationTokens: 300,
        cacheReadTokens: 400,
        outputTokens: 250,
      }),
      tools: [makeTool({ toolName: 'Read', resultBytes: 2048 })],
    }),
  ],
})

/** 路由 id 固定是 session-abc，与 payload 的 sessionId 无关，所以按前缀匹配 */
function stubDetail(payload: ReturnType<typeof makeSessionDetail>, status = 200) {
  return stubFetch((url) =>
    url.startsWith('/api/sessions/') ? jsonResponse(envelope(payload), status) : undefined,
  )
}

beforeEach(() => {
  window.location.hash = '#/sessions/session-abc'
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('SessionDetailPage', () => {
  test('渲染会话元信息头', async () => {
    stubDetail(DETAIL)
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getAllByText('demo-project').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('/Users/demo/work')).toBeInTheDocument()
    expect(screen.getByText('feature/login')).toBeInTheDocument()
    // 模型名同时出现在元信息头与时间线里
    expect(screen.getAllByText('claude-sonnet-4-5-20250929').length).toBeGreaterThan(1)
    expect(screen.getByText('2 行无法解析')).toBeInTheDocument()
    // 0.0104 超过 0.01 阈值，按 2 位小数展示
    expect(screen.getByText('$0.01')).toBeInTheDocument()
  })

  test('起止时间按本地时区展示', async () => {
    stubDetail(DETAIL)
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('2 行无法解析')).toBeInTheDocument()
    })
    // 起止时间区间是一条 dd，UTC 08:00 -> 09:30 平移后仍是 2026-10-19
    expect(screen.getAllByText(/2026-10-19/).length).toBeGreaterThan(0)
  })

  test('缺失字段显示占位符', async () => {
    stubDetail(
      makeSessionDetail({
        cwd: null,
        gitBranch: null,
        models: [],
        startedAt: null,
        endedAt: null,
      }),
    )
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('无')).toBeInTheDocument()
    })
    // cwd / gitBranch / 模型 三处都该落到 '-' 占位符
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(3)
  })

  test('渲染 turn 时间线、瀑布图与工具明细', async () => {
    stubDetail(DETAIL)
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getAllByTestId('turn-item')).toHaveLength(2)
    })

    expect(screen.getByRole('heading', { name: /Turn 时间线/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Token 瀑布图' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '工具调用明细' })).toBeInTheDocument()
    expect(screen.getByText('帮我看看')).toBeInTheDocument()
    expect(screen.getByText('好的，我来处理')).toBeInTheDocument()
    // Read 同时出现在时间线徽标与工具明细表
    expect(screen.getAllByText('Read').length).toBe(2)
  })

  test('瀑布图只统计 assistant turn', async () => {
    stubDetail(makeSessionDetail({ turns: [makeTurn({ role: 'user', usage: null })] }))
    const { container } = render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByTestId('turn-item')).toBeInTheDocument()
    })
    expect(screen.getByTestId('waterfall-empty')).toBeInTheDocument()
    expect(container.querySelector('.recharts-responsive-container')).toBeNull()
  })

  test('404 显示"会话不存在"', async () => {
    stubFetch(() => jsonResponse({ success: false, data: null, error: 'x' }, 404))
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('会话不存在')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('turn-timeline')).not.toBeInTheDocument()
  })

  test('其他错误显示错误态', async () => {
    stubDetail(DETAIL, 500)
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('请求失败（HTTP 500）')).toBeInTheDocument()
  })

  test('加载中显示骨架', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    render(<SessionDetailPage sessionId="session-abc" />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  test('返回按钮导航到会话列表', async () => {
    stubDetail(DETAIL)
    render(<SessionDetailPage sessionId="session-abc" />)
    await waitFor(() => {
      expect(screen.getAllByText('demo-project').length).toBeGreaterThan(0)
    })

    await userEvent.click(screen.getByRole('button', { name: /返回会话列表/ }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/sessions')
    })
  })

  test('解析错误为 0 时显示"无"', async () => {
    stubDetail(makeSessionDetail({ parseErrorCount: 0 }))
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('无')).toBeInTheDocument()
    })
  })

  test('成本为 0 时格式化仍成立', async () => {
    stubDetail(makeSessionDetail({ cost: makeCost({ totalCost: 0 }) }))
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('$0.00')).toBeInTheDocument()
    })
  })

  test('token 总量汇总四类用量', async () => {
    stubDetail(
      makeSessionDetail({
        usage: makeUsage({
          inputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
        }),
      }),
    )
    render(<SessionDetailPage sessionId="session-abc" />)

    await waitFor(() => {
      expect(screen.getByText('1,000')).toBeInTheDocument()
    })
  })
})

describe('SessionDetailPage 的链条筛选', () => {
  /** 一场主链 + 侧链混合的会话 */
  function mixedDetail() {
    return makeSessionDetail({
      sessionId: 'session-abc',
      turns: [
        makeTurn({ uuid: 'u1', role: 'user', usage: null, textPreview: '主对话问题' }),
        makeTurn({
          uuid: 'a1',
          role: 'assistant',
          textPreview: '主对话回答',
          usage: makeUsage({ inputTokens: 1200, outputTokens: 250 }),
        }),
        makeTurn({
          uuid: 's1',
          role: 'assistant',
          isSidechain: true,
          textPreview: 'subagent 干活',
          usage: makeUsage({ inputTokens: 5000, outputTokens: 800 }),
        }),
      ],
    })
  }

  test('没有侧链时不渲染筛选器', async () => {
    // Arrange：默认夹具全是主链
    stubDetail(DETAIL)
    render(<SessionDetailPage sessionId="session-abc" />)

    // Assert：等数据落地后，筛选器仍不该出现
    await waitFor(() => {
      expect(screen.getByText('Turn 时间线（2）')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('chain-filter-all')).not.toBeInTheDocument()
  })

  test('有侧链时渲染筛选器并显示两种计数', async () => {
    // Arrange
    stubDetail(mixedDetail())
    render(<SessionDetailPage sessionId="session-abc" />)

    // Assert
    await waitFor(() => {
      expect(screen.getByTestId('chain-filter-all')).toBeInTheDocument()
    })
    // 全部 3、主对话 2、仅 subagent 1
    expect(screen.getByTestId('chain-filter-all')).toHaveTextContent('全部')
    expect(screen.getByTestId('chain-filter-all')).toHaveTextContent('3')
    expect(screen.getByTestId('chain-filter-main')).toHaveTextContent('2')
    expect(screen.getByTestId('chain-filter-side')).toHaveTextContent('1')
  })

  test('点「仅 subagent」后时间线与瀑布图都只剩侧链', async () => {
    // Arrange
    const fetch = stubDetail(mixedDetail())
    render(<SessionDetailPage sessionId="session-abc" />)
    await waitFor(() => {
      expect(screen.getByTestId('chain-filter-side')).toBeInTheDocument()
    })

    // Act
    await userEvent.click(screen.getByTestId('chain-filter-side'))

    // Assert：标题计数从 3 变 1，且 URL 带上 chain=side（刷新可保留）
    await waitFor(() => {
      expect(screen.getByText('Turn 时间线（1）')).toBeInTheDocument()
    })
    expect(window.location.hash).toContain('chain=side')
    expect(fetch.lastCallFor('?chain=side').url).toBe('/api/sessions/session-abc?chain=side&page=1')
    // 侧链那条的预览文本在，主对话那条不在
    expect(screen.getByText('subagent 干活')).toBeInTheDocument()
    expect(screen.queryByText('主对话回答')).not.toBeInTheDocument()
  })

  test('URL 里的 chain=main 决定初始视图', async () => {
    // Arrange
    window.location.hash = '#/sessions/session-abc?chain=main'
    stubDetail(mixedDetail())
    render(<SessionDetailPage sessionId="session-abc" />)

    // Assert：直接以主对话口径渲染，无需点击
    await waitFor(() => {
      expect(screen.getByText('Turn 时间线（2）')).toBeInTheDocument()
    })
    expect(screen.getByTestId('chain-filter-main')).toHaveAttribute('aria-pressed', 'true')
  })

  test('非法 chain 值回退全部', async () => {
    // Arrange
    window.location.hash = '#/sessions/session-abc?chain=bogus'
    stubDetail(mixedDetail())
    render(<SessionDetailPage sessionId="session-abc" />)

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Turn 时间线（3）')).toBeInTheDocument()
    })
    expect(screen.getByTestId('chain-filter-all')).toHaveAttribute('aria-pressed', 'true')
  })
})
