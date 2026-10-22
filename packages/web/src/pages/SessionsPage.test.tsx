import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SessionsPage } from './SessionsPage'
import { envelope, makeOverview, makeProjectStats, makeSessionListItem } from '../test/fixtures'
import { jsonResponse, stubFetch } from '../test/fetchStub'
import { nthElement, selectValue } from '../test/dom'

const OVERVIEW = makeOverview({
  byProject: [
    makeProjectStats({ projectSlug: 'alpha' }),
    makeProjectStats({ projectSlug: 'beta' }),
  ],
})

/** 造 n 条会话，用来把分页撑起来 */
function makeMany(count: number) {
  return Array.from({ length: count }, (_unused, index) =>
    makeSessionListItem({ sessionId: `session-${index}`, projectSlug: 'alpha' }),
  )
}

function stubSessions(
  list: readonly ReturnType<typeof makeSessionListItem>[],
  options: { emptyOnPage?: number } = {},
) {
  const emptyOnPage = options.emptyOnPage
  return stubFetch((url, init) => {
    if (url === '/api/stats/overview') {
      return jsonResponse(envelope(OVERVIEW))
    }
    if (url.startsWith('/api/sessions')) {
      // 默认每一页都给同一份数据，只有显式指定 emptyOnPage 的页码才返回空数组
      const page = Number(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('page'))
      if (emptyOnPage !== undefined && page === emptyOnPage) {
        return jsonResponse(envelope([]))
      }
      return jsonResponse(envelope(list))
    }
    if (url === '/api/scan') {
      return jsonResponse(envelope({ jobId: 'job-1', status: 'queued' }))
    }
    void init
    return undefined
  })
}

beforeEach(() => {
  window.location.hash = '#/sessions'
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('SessionsPage', () => {
  test('渲染表格与分页条', async () => {
    const stub = stubSessions(makeMany(3))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(3)
    })

    expect(screen.getByTestId('pagination')).toBeInTheDocument()
    expect(screen.getByText('第 1 页')).toBeInTheDocument()
    // 不足一页，下一页应禁用
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()

    const sessionsCall = stub.lastCallFor('/api/sessions?')
    expect(sessionsCall.url).toContain('limit=20')
    expect(sessionsCall.url).toContain('page=1')
    expect(sessionsCall.url).toContain('sort=cost')
    expect(sessionsCall.url).toContain('order=desc')
  })

  test('项目下拉来自 overview.byProject', async () => {
    stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('session-filters')).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox', { name: '项目' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['全部', 'alpha', 'beta'])
  })

  test('URL 带 project 参数时下拉回显', async () => {
    window.location.hash = '#/sessions?project=beta'
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    const select = screen.getByRole('combobox', { name: '项目' })
    expect(selectValue(select)).toBe('beta')
    expect(stub.lastCallFor('/api/sessions?').url).toContain('project=beta')
  })

  // ?project= 和 ?project=%20 都能从地址栏造出来。只挡 null/undefined 的话，
  // 空串会被当成真实过滤条件发出 project=，API 的 zod（.trim().min(1)）直接 400。
  test.each(['', '%20', '%20%20'])('project 参数是空白 %s 时当作没有筛选', async (raw) => {
    window.location.hash = `#/sessions?project=${raw}`
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    expect(selectValue(screen.getByRole('combobox', { name: '项目' }))).toBe('')
    expect(stub.lastCallFor('/api/sessions?').url).not.toContain('project=')
  })

  test('选择项目后写进 hash 并重新请求', async () => {
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '项目' }), 'alpha')

    await waitFor(() => {
      expect(window.location.hash).toBe('#/sessions?project=alpha')
    })
    expect(stub.lastCallFor('/api/sessions?').url).toContain('project=alpha')
  })

  test('切回「全部」时清掉 project 过滤', async () => {
    window.location.hash = '#/sessions?project=alpha'
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(stub.lastCallFor('/api/sessions?').url).toContain('project=alpha')
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '项目' }), '')

    await waitFor(() => {
      expect(window.location.hash).toBe('#/sessions')
    })
    expect(selectValue(screen.getByRole('combobox', { name: '项目' }))).toBe('')
    expect(stub.lastCallFor('/api/sessions?').url).not.toContain('project=')
  })

  test('点击下一页带上 page=2', async () => {
    const stub = stubSessions(makeMany(20))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(20)
    })
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(stub.lastCallFor('/api/sessions?').url).toContain('page=2')
    })
    expect(screen.getByText('第 2 页')).toBeInTheDocument()
  })

  test('翻到空页后自动回退一页', async () => {
    const stub = stubSessions(makeMany(20), { emptyOnPage: 2 })
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(20)
    })

    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(
        stub.calls.some(
          (call) => call.url.includes('/api/sessions?') && call.url.includes('page=2'),
        ),
      ).toBe(true)
    })

    // page=2 返回空数组，组件应自己退回第 1 页而不是停在空白表格
    await waitFor(() => {
      expect(screen.getByText('第 1 页')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('session-row')).toHaveLength(20)
  })

  test('切换项目筛选时回到第一页', async () => {
    // 停在 page=2 再换筛选条件，新结果的第 2 页可能不存在，用户会看到空白表格
    const stub = stubSessions(makeMany(20))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(20)
    })

    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(screen.getByText('第 2 页')).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '项目' }), 'alpha')

    await waitFor(() => {
      expect(screen.getByText('第 1 页')).toBeInTheDocument()
    })
    const lastCall = stub.lastCallFor('/api/sessions?')
    expect(lastCall.url).toContain('page=1')
    expect(lastCall.url).toContain('project=alpha')
  })

  test('点击方向按钮切换升降序', async () => {
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    await userEvent.click(screen.getByRole('button', { name: '降序' }))

    await waitFor(() => {
      expect(stub.lastCallFor('/api/sessions?').url).toContain('order=asc')
    })
    expect(screen.getByRole('button', { name: '升序' })).toBeInTheDocument()

    // 再点一次应当原路返回，而不是卡在 asc
    await userEvent.click(screen.getByRole('button', { name: '升序' }))
    await waitFor(() => {
      expect(stub.lastCallFor('/api/sessions?').url).toContain('order=desc')
    })
    expect(screen.getByRole('button', { name: '降序' })).toBeInTheDocument()
  })

  test('上一页在第一页禁用', async () => {
    stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  test('在第二页可以点上一页回去', async () => {
    const stub = stubSessions(makeMany(20))
    render(<SessionsPage />)
    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(20)
    })

    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(screen.getByText('第 2 页')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => {
      expect(stub.lastCallFor('/api/sessions?').url).toContain('page=1')
    })
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  test('空数据显示中文引导', async () => {
    stubSessions([])
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getByText('没有会话数据')).toBeInTheDocument()
    })
    expect(screen.getByText(/turnflare scan/)).toBeInTheDocument()
  })

  test('点击行导航到详情', async () => {
    stubSessions(makeMany(2))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(2)
    })

    await userEvent.click(nthElement(screen.getAllByTestId('session-row'), 0))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/sessions/session-0')
    })
  })

  test('触发扫描后刷新数据并给出反馈', async () => {
    const stub = stubSessions(makeMany(1))
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    await userEvent.click(screen.getByRole('button', { name: '触发扫描' }))

    await waitFor(() => {
      expect(screen.getByTestId('scan-note')).toBeInTheDocument()
    })
    expect(screen.getByText('扫描任务已提交')).toBeInTheDocument()
    expect(stub.lastCallFor('/api/scan').init?.method).toBe('POST')
    // 扫描成功后重新拉了两份数据
    expect(
      stub.calls.filter((call) => call.url.startsWith('/api/sessions?')).length,
    ).toBeGreaterThan(1)
  })

  test('扫描失败时把错误显示在按钮旁而不是崩溃', async () => {
    stubFetch((url) => {
      if (url === '/api/stats/overview') {
        return jsonResponse(envelope(OVERVIEW))
      }
      if (url.startsWith('/api/sessions')) {
        return jsonResponse(envelope(makeMany(1)))
      }
      if (url === '/api/scan') {
        return jsonResponse({ success: false, data: null, error: '扫描正在运行' })
      }
      return undefined
    })
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    await userEvent.click(screen.getByRole('button', { name: '触发扫描' }))

    await waitFor(() => {
      expect(screen.getByTestId('scan-note')).toBeInTheDocument()
    })
    expect(screen.getByText('扫描正在运行')).toBeInTheDocument()
    expect(screen.getAllByTestId('session-row')).toHaveLength(1)
  })

  test('扫描抛出非 Error 值时给兜底文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/stats/overview') {
          return Promise.resolve(jsonResponse(envelope(OVERVIEW)))
        }
        if (url.startsWith('/api/sessions')) {
          return Promise.resolve(jsonResponse(envelope(makeMany(1))))
        }
        return Promise.reject('network gone')
      }),
    )
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })

    await userEvent.click(screen.getByRole('button', { name: '触发扫描' }))

    await waitFor(() => {
      expect(screen.getByTestId('scan-note')).toBeInTheDocument()
    })
    expect(screen.getByText('扫描失败，请重试')).toBeInTheDocument()
  })

  test('请求失败显示错误态', async () => {
    stubFetch((url) =>
      url === '/api/stats/overview' ? jsonResponse(envelope(OVERVIEW)) : jsonResponse({}, 503),
    )
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('请求失败（HTTP 503）')).toBeInTheDocument()
  })

  test('overview 失败时只影响项目下拉，表格仍可用', async () => {
    stubFetch((url) => {
      if (url === '/api/stats/overview') {
        return jsonResponse({}, 500)
      }
      if (url.startsWith('/api/sessions')) {
        return jsonResponse(envelope(makeMany(1)))
      }
      return undefined
    })
    render(<SessionsPage />)

    await waitFor(() => {
      expect(screen.getAllByTestId('session-row')).toHaveLength(1)
    })
    expect(screen.getByTestId('project-list-error')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: '项目' })
    expect(within(select).getAllByRole('option')).toHaveLength(1)
  })
})
