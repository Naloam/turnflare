import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useApi, useTrigger } from './useApi'
import { httpResponse, jsonResponse, stubFetch, type FakeResponse } from '../test/fetchStub'

/** 永不 settle 的响应，用来观察"在途请求"被取消的时机 */
function pendingResponse(): Promise<FakeResponse> {
  return new Promise<FakeResponse>(() => {
    // 刻意不 resolve：这个请求应当被 AbortController 掐掉
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useApi 成功路径', () => {
  test('refresh events reload mounted data without clearing the current result', async () => {
    const stub = stubFetch(() => jsonResponse({ success: true, data: 7, error: null }))
    const { result } = renderHook(() => useApi<number>('/stats/overview'))
    await waitFor(() => expect(result.current.data).toBe(7))
    await act(() => window.dispatchEvent(new Event('turnflare:refresh')))
    await waitFor(() => expect(stub.calls).toHaveLength(2))
    expect(result.current.data).toBe(7)
  })
  test('解析包络并落入 data，三态归位', async () => {
    stubFetch((url) =>
      url === '/api/sessions'
        ? jsonResponse({ success: true, data: [1, 2], error: null })
        : undefined,
    )

    const { result } = renderHook(() => useApi<readonly number[]>('/sessions'))

    // 首帧必须是加载态，绝不在加载中渲染 undefined
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual([1, 2])
    expect(result.current.error).toBeNull()
  })

  test('请求地址带上 /api 前缀与 Accept 头', async () => {
    const stub = stubFetch((url) =>
      url === '/api/stats/overview'
        ? jsonResponse({ success: true, data: { ok: true }, error: null })
        : undefined,
    )

    const { result } = renderHook(() => useApi<{ ok: boolean }>('/stats/overview'))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const call = stub.lastCallFor('/api/stats/overview')
    expect(call.url).toBe('/api/stats/overview')
    const headers = call.init?.headers
    expect(headers).toEqual({ Accept: 'application/json' })
  })

  test('success=false 时透出服务端 error 文案', async () => {
    stubFetch(() => jsonResponse({ success: false, data: null, error: '数据库未初始化' }))

    const { result } = renderHook(() => useApi<number>('/stats/overview'))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('数据库未初始化')
  })

  test('success=false 且没有 error 字段时给兜底文案', async () => {
    stubFetch(() => jsonResponse({ success: false, data: null }))

    const { result } = renderHook(() => useApi<number>('/x'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toContain('服务端')
  })
})

describe('useApi 失败路径', () => {
  test('HTTP 非 2xx 时报出状态码', async () => {
    stubFetch(() => httpResponse(500))

    const { result } = renderHook(() => useApi<number>('/boom'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toBe('请求失败（HTTP 500）')
    expect(result.current.data).toBeNull()
  })

  test('失败响应的 body 不是 JSON 时退回到状态码文案', async () => {
    // 现实场景：网关/反代在 502 时返回一段 HTML，response.json() 直接抛。
    // 这时只能靠状态码兜底，不能把 SyntaxError 泄给用户。
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        }),
      ),
    )

    const { result } = renderHook(() => useApi<number>('/bad-gateway'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toBe('请求失败（HTTP 502）')
  })

  test('失败响应体解析途中卸载，迟到结果不写入 state', async () => {
    const jsonGates: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            new Promise((resolve) => {
              jsonGates.push(() => resolve({ success: false, data: null, error: '迟到' }))
            }),
        }),
      ),
    )

    const { result, unmount } = renderHook(() => useApi<number>('/slow-fail'))
    await act(async () => {})
    expect(jsonGates).toHaveLength(1)

    unmount()
    await act(async () => {
      jsonGates[0]?.()
    })

    expect(result.current.error).toBeNull()
  })

  test('网络层失败时报中文可读错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    const { result } = renderHook(() => useApi<number>('/offline'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toBe('网络请求失败：无法连接到 API 服务')
  })

  test('响应体不是合法 JSON 时报解析失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
        }),
      ),
    )

    const { result } = renderHook(() => useApi<number>('/broken'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toContain('JSON')
  })

  test('包络形状不对时报解析失败', async () => {
    stubFetch(() => jsonResponse([1, 2, 3]))

    const { result } = renderHook(() => useApi<number>('/weird'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toContain('JSON')
  })

  test('成功响应缺 data 键时报解析失败，而不是把 undefined 送进渲染层', async () => {
    // isApiEnvelope 要求 data 键存在。缺了它就是坏响应，必须在边界上变成错误态；
    // 否则 undefined 会一路流到图表和表格，那里读 data.xxx 才炸。
    stubFetch(() => jsonResponse({ success: true, error: null }))

    const { result } = renderHook(() => useApi<number>('/no-data'))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    expect(result.current.error).toContain('JSON')
    expect(result.current.data).toBeNull()
  })
})

describe('useApi 取消与重取', () => {
  test('卸载时取消在途请求', async () => {
    const signals: AbortSignal[] = []
    stubFetch((_url, init) => {
      const signal = init?.signal
      if (signal !== undefined && signal !== null) {
        signals.push(signal)
      }
      return pendingResponse()
    })

    const { unmount } = renderHook(() => useApi<number>('/slow'))
    await act(async () => {
      // 让 effect 跑完，确保 fetch 已被调用
    })

    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    unmount()
    expect(signals[0]?.aborted).toBe(true)
  })

  test('path 变化时取消上一条在途请求', async () => {
    const signals: AbortSignal[] = []
    stubFetch((_url, init) => {
      const signal = init?.signal
      if (signal !== undefined && signal !== null) {
        signals.push(signal)
      }
      return pendingResponse()
    })

    const { rerender } = renderHook(({ path }: { path: string }) => useApi<number>(path), {
      initialProps: { path: '/first' },
    })
    await act(async () => {})

    rerender({ path: '/second' })
    await act(async () => {})

    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  test('取消后的迟到响应不会写入 state', async () => {
    // 每次 fetch 拿一个独立闸门：必须能只放开第一条请求的响应。
    // 若两条请求共享同一个 Promise，放开时第二条（仍然活跃）也会 resolve，测出来的是假象。
    const gates: ((response: FakeResponse) => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<FakeResponse>((resolve) => {
            gates.push(resolve)
          }),
      ),
    )

    const { result, rerender } = renderHook(({ path }: { path: string }) => useApi<string>(path), {
      initialProps: { path: '/a' },
    })
    await act(async () => {})

    rerender({ path: '/b' })
    await act(async () => {})

    expect(gates).toHaveLength(2)

    // 迟到的是第一条请求的响应，此时组件已切到 /b
    await act(async () => {
      gates[0]?.(jsonResponse({ success: true, data: 'stale', error: null }))
    })

    expect(result.current.data).toBeNull()
  })

  test('响应体解析途中卸载，迟到结果不写入 state', async () => {
    const jsonGates: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              jsonGates.push(() => resolve({ success: true, data: 'late', error: null }))
            }),
        }),
      ),
    )

    const { result, unmount } = renderHook(() => useApi<string>('/slow'))
    await act(async () => {})
    expect(jsonGates).toHaveLength(1)

    unmount()
    await act(async () => {
      jsonGates[0]?.()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  test('响应体解析失败且已卸载时不报错也不写 state', async () => {
    const jsonGates: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              jsonGates.push(() => reject(new SyntaxError('bad json')))
            }),
        }),
      ),
    )

    const { result, unmount } = renderHook(() => useApi<string>('/slow'))
    await act(async () => {})

    unmount()
    await act(async () => {
      jsonGates[0]?.()
    })

    expect(result.current.error).toBeNull()
  })

  test('fetch reject 且已卸载时不报错也不写 state', async () => {
    // 与上一条互补：网络层 catch 里的 isStale() 早退分支。取消用例用的都是
    // 永不 settle 的 Promise，catch 永远不执行，这条专门把拒绝推迟到卸载之后。
    const rejectGates: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<FakeResponse>((_resolve, reject) => {
            rejectGates.push(() => reject(new TypeError('Failed to fetch')))
          }),
      ),
    )

    const { result, unmount } = renderHook(() => useApi<number>('/offline-late'))
    await act(async () => {})
    expect(rejectGates).toHaveLength(1)

    unmount()
    await act(async () => {
      rejectGates[0]?.()
    })

    // 卸载后的迟到拒绝是取消信号而不是故障：既不写错误，也不动 loading
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  test('deps 变化触发重新请求', async () => {
    let counter = 0
    stubFetch((url) => {
      if (!url.startsWith('/api/sessions')) {
        return undefined
      }
      counter += 1
      return jsonResponse({ success: true, data: counter, error: null })
    })

    const { result, rerender } = renderHook(
      ({ dep }: { dep: string }) => useApi<number>('/sessions', [dep]),
      { initialProps: { dep: 'first' } },
    )
    await waitFor(() => {
      expect(result.current.data).toBe(1)
    })

    rerender({ dep: 'second' })
    await waitFor(() => {
      expect(result.current.data).toBe(2)
    })
  })

  test('deps 不变则不重复请求', async () => {
    let counter = 0
    stubFetch((url) => {
      if (!url.startsWith('/api/sessions')) {
        return undefined
      }
      counter += 1
      return jsonResponse({ success: true, data: counter, error: null })
    })

    const { result, rerender } = renderHook(
      ({ dep }: { dep: string }) => useApi<number>('/sessions', [dep]),
      { initialProps: { dep: 'same' } },
    )
    await waitFor(() => {
      expect(result.current.data).toBe(1)
    })

    rerender({ dep: 'same' })
    await act(async () => {})

    expect(counter).toBe(1)
    expect(result.current.data).toBe(1)
  })

  test('deps 含不可序列化值（BigInt）时不抛异常', async () => {
    stubFetch((url) =>
      url === '/api/x' ? jsonResponse({ success: true, data: 'ok', error: null }) : undefined,
    )

    const { result } = renderHook(() => useApi<string>('/x', [BigInt(1)]))

    await waitFor(() => {
      expect(result.current.data).toBe('ok')
    })
    expect(result.current.error).toBeNull()
  })

  test('reload() 重新发起请求', async () => {
    let counter = 0
    stubFetch((url) => {
      if (url !== '/api/sessions') {
        return undefined
      }
      counter += 1
      return jsonResponse({ success: true, data: counter, error: null })
    })

    const { result } = renderHook(() => useApi<number>('/sessions'))
    await waitFor(() => {
      expect(result.current.data).toBe(1)
    })

    act(() => {
      result.current.reload()
    })
    await waitFor(() => {
      expect(result.current.data).toBe(2)
    })
    expect(counter).toBe(2)
  })

  test('重新请求期间保留上一份数据，不清空界面', async () => {
    let counter = 0
    let gate: (response: FakeResponse) => void = () => {}
    stubFetch(() => {
      counter += 1
      if (counter === 1) {
        return jsonResponse({ success: true, data: 'first', error: null })
      }
      return new Promise<FakeResponse>((resolve) => {
        gate = resolve
      })
    })

    const { result } = renderHook(() => useApi<string>('/sessions'))
    await waitFor(() => {
      expect(result.current.data).toBe('first')
    })

    act(() => {
      result.current.reload()
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBe('first')

    await act(async () => {
      gate(jsonResponse({ success: true, data: 'second', error: null }))
    })
    expect(result.current.data).toBe('second')
    expect(result.current.loading).toBe(false)
  })
})

describe('useTrigger', () => {
  test('成功时返回载荷并复位 running', async () => {
    const stub = stubFetch((url, init) =>
      url === '/api/scan' && init?.method === 'POST'
        ? jsonResponse({ success: true, data: { jobId: 'j-1' }, error: null })
        : undefined,
    )

    const { result } = renderHook(() => useTrigger())

    let promise: Promise<unknown> = Promise.resolve()
    await act(async () => {
      promise = result.current.run('/scan', { method: 'POST' })
    })
    expect(result.current.running).toBe(false)

    const payload = await promise
    expect(payload).toEqual({ success: true, data: { jobId: 'j-1' }, error: null })
    expect(stub.lastCallFor('/api/scan').init?.method).toBe('POST')
  })

  test('running 在请求期间为 true', async () => {
    let gate: (response: FakeResponse) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<FakeResponse>((resolve) => {
            gate = resolve
          }),
      ),
    )

    const { result } = renderHook(() => useTrigger())

    let promise: Promise<unknown> = Promise.resolve()
    act(() => {
      promise = result.current.run('/scan', { method: 'POST' })
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      gate(jsonResponse({ success: true, data: null, error: null }))
      await promise
    })
    expect(result.current.running).toBe(false)
  })

  test('HTTP 失败时 reject 出状态码文案', async () => {
    stubFetch(() => httpResponse(503))

    const { result } = renderHook(() => useTrigger())

    await expect(
      act(async () => {
        await result.current.run('/scan', { method: 'POST' })
      }),
    ).rejects.toThrow('请求失败（HTTP 503）')
    expect(result.current.running).toBe(false)
  })

  test('success=false 时 reject 出服务端 error', async () => {
    stubFetch(() => jsonResponse({ success: false, data: null, error: '扫描正在运行' }))

    const { result } = renderHook(() => useTrigger())

    await expect(
      act(async () => {
        await result.current.run('/scan', { method: 'POST' })
      }),
    ).rejects.toThrow('扫描正在运行')
  })

  test('网络失败时也 reject', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )

    const { result } = renderHook(() => useTrigger())

    await expect(
      act(async () => {
        await result.current.run('/scan', { method: 'POST' })
      }),
    ).rejects.toThrow()
    expect(result.current.running).toBe(false)
  })

  test('合并而非覆盖请求头：Accept 保留，调用方的 Content-Type 不被冲掉', async () => {
    // 回归测试：曾经写成 headers: { Accept: ... } 直接盖掉 init.headers，
    // 于是 POST /scan 丢掉 application/json 声明。合并顺序必须是 Accept 在前。
    const stub = stubFetch((url) =>
      url === '/api/scan' ? jsonResponse({ success: true, data: null, error: null }) : undefined,
    )

    const { result } = renderHook(() => useTrigger())

    await act(async () => {
      await result.current.run('/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    })

    expect(stub.lastCallFor('/api/scan').init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
  })

  test('调用方没传 headers 时只发 Accept', async () => {
    const stub = stubFetch((url) =>
      url === '/api/scan' ? jsonResponse({ success: true, data: null, error: null }) : undefined,
    )

    const { result } = renderHook(() => useTrigger())

    await act(async () => {
      await result.current.run('/scan', { method: 'POST' })
    })

    expect(stub.lastCallFor('/api/scan').init?.headers).toEqual({ Accept: 'application/json' })
  })
})
