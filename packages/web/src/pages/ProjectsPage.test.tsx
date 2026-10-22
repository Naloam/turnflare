import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectsPage } from './ProjectsPage'
import { envelope, makeCost, makeProjectStats, makeUsage } from '../test/fixtures'
import { jsonResponse, stubFetch } from '../test/fetchStub'
import { nthElement } from '../test/dom'

const PROJECTS = [
  makeProjectStats({
    projectSlug: 'alpha',
    sessionCount: 5,
    cost: makeCost({ totalCost: 7.5 }),
    usage: makeUsage({
      inputTokens: 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    }),
  }),
  makeProjectStats({
    projectSlug: 'beta',
    sessionCount: 2,
    cost: makeCost({ totalCost: 2.5 }),
    usage: makeUsage({
      inputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    }),
  }),
]

beforeEach(() => {
  window.location.hash = '#/projects'
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('ProjectsPage', () => {
  test('渲染横向柱状图与明细表', async () => {
    const stub = stubFetch((url) =>
      url === '/api/stats/projects' ? jsonResponse(envelope(PROJECTS)) : undefined,
    )
    const { container } = render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    })

    expect(screen.getByRole('heading', { name: '项目成本对比' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '项目明细' })).toBeInTheDocument()
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
    expect(stub.lastCallFor('/api/stats/projects').url).toBe('/api/stats/projects')
  })

  test('表格展示会话数、token、成本与占比', async () => {
    stubFetch((url) =>
      url === '/api/stats/projects' ? jsonResponse(envelope(PROJECTS)) : undefined,
    )
    render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    })

    const firstRow = nthElement(screen.getAllByTestId('project-row'), 0)
    expect(within(firstRow).getByText('alpha')).toBeInTheDocument()
    expect(within(firstRow).getByText('5')).toBeInTheDocument()
    expect(within(firstRow).getByText('1K')).toBeInTheDocument()
    expect(within(firstRow).getByText('$7.50')).toBeInTheDocument()
    expect(within(firstRow).getByTestId('stat-bar-fill')).toHaveStyle({ width: '75%' })
    expect(within(firstRow).getByText('75.0%')).toBeInTheDocument()
  })

  test('点击项目跳到会话列表并带上筛选', async () => {
    stubFetch((url) =>
      url === '/api/stats/projects' ? jsonResponse(envelope(PROJECTS)) : undefined,
    )
    render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    })

    await userEvent.click(nthElement(screen.getAllByTestId('project-row'), 1))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/sessions?project=beta')
    })
  })

  test('总成本为 0 时占比全部为 0 而不是 NaN', async () => {
    const zeroed = PROJECTS.map((project) =>
      makeProjectStats({ projectSlug: project.projectSlug, cost: makeCost({ totalCost: 0 }) }),
    )
    stubFetch((url) => (url === '/api/stats/projects' ? jsonResponse(envelope(zeroed)) : undefined))
    render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    })
    expect(screen.getAllByText('0.0%')).toHaveLength(2)
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })

  test('空数据显示引导空态', async () => {
    stubFetch((url) => (url === '/api/stats/projects' ? jsonResponse(envelope([])) : undefined))
    render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getByText('还没有项目数据')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('projects-table')).not.toBeInTheDocument()
  })

  test('请求失败显示错误态', async () => {
    stubFetch(() => jsonResponse({}, 500))
    render(<ProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
  })
})
