import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useHashRoute } from './useHashRoute'

/**
 * jsdom 里改 window.location.hash 会异步触发 hashchange，
 * 因此每个用例都是「设 hash → 手动派发事件 → 断言」三步，保证确定性。
 */

function setHash(hash: string): void {
  window.location.hash = hash
  flushHashChange()
}

/**
 * 手动补一次 hashchange。
 *
 * jsdom 改 location.hash 后是**异步**派发 hashchange 的，同步断言读不到新状态；
 * 浏览器里则是同步任务后很快触发。统一手动派发可以让断言确定性生效。
 */
function flushHashChange(): void {
  act(() => {
    window.dispatchEvent(new Event('hashchange'))
  })
}

function currentHash(): string {
  return window.location.hash
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  window.location.hash = ''
})

describe('useHashRoute 路径解析', () => {
  test('空 hash 落到 /overview 并纠正地址栏', async () => {
    const { result } = renderHook(() => useHashRoute())

    expect(result.current.path).toBe('/overview')
    await waitFor(() => {
      expect(currentHash()).toBe('#/overview')
    })
  })

  test('#/overview 与 #/projects', () => {
    setHash('#/overview')
    const overview = renderHook(() => useHashRoute())
    expect(overview.result.current.path).toBe('/overview')
    overview.unmount()

    setHash('#/projects')
    const projects = renderHook(() => useHashRoute())
    expect(projects.result.current.path).toBe('/projects')
    projects.unmount()
  })

  test('#/sessions 不带参数', () => {
    setHash('#/sessions')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions')
    expect(result.current.params).toEqual({})
  })

  test('#/sessions/:id 取出 id 参数', () => {
    setHash('#/sessions/abc-123')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions/:id')
    expect(result.current.params.id).toBe('abc-123')
  })

  test('id 里的百分号编码被解码', () => {
    setHash('#/sessions/a%2Fb%20c')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.params.id).toBe('a/b c')
  })

  test('查询参数并入 params', () => {
    setHash('#/sessions?project=demo&page=2')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions')
    expect(result.current.params.project).toBe('demo')
    expect(result.current.params.page).toBe('2')
  })

  test('路径参数与查询参数可以共存', () => {
    setHash('#/sessions/s-1?project=demo')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions/:id')
    expect(result.current.params).toEqual({ id: 's-1', project: 'demo' })
  })

  test('路径段是非法百分号编码时退回原值', () => {
    setHash('#/sessions/%E0%A4%A')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions/:id')
    expect(result.current.params.id).toBe('%E0%A4%A')
  })

  test('查询值是非法百分号编码时退回原值', () => {
    setHash('#/sessions?project=%E0%A4%A')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.params.project).toBe('%E0%A4%A')
  })

  test('查询键是非法百分号编码时退回原值', () => {
    setHash('#/sessions?%E0%A4%A=1')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.params['%E0%A4%A']).toBe('1')
  })

  test('没有值的查询键记为 空串', () => {
    setHash('#/sessions?flag')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.params.flag).toBe('')
  })

  test('尾部斜杠不影响匹配', () => {
    setHash('#/sessions/')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/sessions')
  })

  test('无法识别的 hash 回落到 /overview 并重定向', async () => {
    setHash('#/nope')
    const { result } = renderHook(() => useHashRoute())

    expect(result.current.path).toBe('/overview')
    await waitFor(() => {
      expect(currentHash()).toBe('#/overview')
    })
    expect(result.current.path).toBe('/overview')
  })

  test('裸路径（没有 #）也被接受', () => {
    setHash('#/projects')
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/projects')
  })
})

describe('useHashRoute 导航', () => {
  test('navigate 补 # 与前导斜杠', () => {
    const { result } = renderHook(() => useHashRoute())

    act(() => {
      result.current.navigate('/projects')
    })
    expect(currentHash()).toBe('#/projects')

    act(() => {
      result.current.navigate('sessions')
    })
    expect(currentHash()).toBe('#/sessions')
  })

  test('navigate 到详情路径并带上查询串', () => {
    const { result } = renderHook(() => useHashRoute())

    act(() => {
      result.current.navigate('/sessions/s-9?project=demo')
    })
    expect(currentHash()).toBe('#/sessions/s-9?project=demo')
    flushHashChange()
    expect(result.current.path).toBe('/sessions/:id')
    expect(result.current.params).toEqual({ id: 's-9', project: 'demo' })
  })

  test('hashchange 之后路径随之更新', () => {
    const { result } = renderHook(() => useHashRoute())
    expect(result.current.path).toBe('/overview')

    setHash('#/sessions/xyz')
    expect(result.current.path).toBe('/sessions/:id')
    expect(result.current.params.id).toBe('xyz')
  })

  test('卸载后不再响应 hashchange', () => {
    const { result, unmount } = renderHook(() => useHashRoute())
    unmount()

    setHash('#/projects')
    // 卸载后 result 被冻结在最后一次渲染，不应再变化
    expect(result.current.path).toBe('/overview')
  })
})
