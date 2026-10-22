import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App, RouteView } from './App'
import {
  envelope,
  makeOverview,
  makeProjectStats,
  makeSessionDetail,
  makeSessionListItem,
} from './test/fixtures'
import { jsonResponse, stubFetch } from './test/fetchStub'

/**
 * App 层的测试只关心"路由 -> 页面"的映射，
 * 各页面自己的行为由 src/pages/*.test.tsx 覆盖。
 */

function stubAll() {
  return stubFetch((url) => {
    if (url === '/api/stats/overview') {
      return jsonResponse(envelope(makeOverview({ byProject: [makeProjectStats()] })))
    }
    if (url === '/api/stats/projects') {
      return jsonResponse(envelope([makeProjectStats()]))
    }
    if (url.startsWith('/api/sessions/')) {
      return jsonResponse(envelope(makeSessionDetail()))
    }
    if (url.startsWith('/api/sessions')) {
      return jsonResponse(envelope([makeSessionListItem()]))
    }
    return undefined
  })
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('RouteView', () => {
  test('/overview 分发到总览页', async () => {
    stubAll()
    render(<RouteView path="/overview" params={{}} />)

    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })
  })

  test('/sessions 分发到会话列表', async () => {
    stubAll()
    render(<RouteView path="/sessions" params={{}} />)

    await waitFor(() => {
      expect(screen.getByTestId('session-filters')).toBeInTheDocument()
    })
  })

  test('/sessions/:id 分发到详情页并传入 id', async () => {
    const stub = stubAll()
    render(<RouteView path="/sessions/:id" params={{ id: 'session-abc' }} />)

    await waitFor(() => {
      expect(screen.getByText(/Turn 时间线/)).toBeInTheDocument()
    })
    expect(stub.lastCallFor('/api/sessions/').url).toBe('/api/sessions/session-abc')
  })

  test('/sessions/:id 缺少 id 参数时按"会话不存在"处理', async () => {
    stubAll()
    render(<RouteView path="/sessions/:id" params={{}} />)

    await waitFor(() => {
      expect(screen.getByText('会话不存在')).toBeInTheDocument()
    })
  })

  test('/projects 分发到项目对比页', async () => {
    stubAll()
    render(<RouteView path="/projects" params={{}} />)

    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeInTheDocument()
    })
  })

  test('未知路径显示兜底空态', () => {
    render(<RouteView path="/nope" params={{}} />)

    expect(screen.getByText('页面不存在')).toBeInTheDocument()
  })
})

describe('App', () => {
  test('按当前 hash 渲染对应页面并带上外壳', async () => {
    window.location.hash = '#/projects'
    stubAll()
    render(<App />)

    // 外壳：侧边导航 + 顶栏主题切换
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeInTheDocument()
    })
  })

  test('空 hash 落到总览页', async () => {
    stubAll()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })
    expect(window.location.hash).toBe('#/overview')
  })

  test('无法识别的 hash 被重定向回总览页', async () => {
    window.location.hash = '#/garbage'
    stubAll()
    render(<App />)

    await waitFor(() => {
      expect(window.location.hash).toBe('#/overview')
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    })
  })
})
