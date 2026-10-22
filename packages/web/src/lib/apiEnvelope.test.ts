import { describe, expect, test } from 'vitest'
import {
  httpStatusError,
  isApiEnvelope,
  isRecord,
  MALFORMED_RESPONSE_ERROR,
  NETWORK_ERROR,
  UNKNOWN_API_ERROR,
} from './apiEnvelope'

describe('isRecord', () => {
  test.each([
    { input: {}, expected: true },
    { input: { a: 1 }, expected: true },
    { input: [], expected: false },
    { input: null, expected: false },
    { input: 'str', expected: false },
    { input: 42, expected: false },
    { input: undefined, expected: false },
  ])('$input -> $expected', ({ input, expected }) => {
    expect(isRecord(input)).toBe(expected)
  })
})

describe('isApiEnvelope', () => {
  test('接受带 boolean success 的包络', () => {
    const payload: unknown = { success: true, data: [1, 2], error: null }
    expect(isApiEnvelope<readonly number[]>(payload)).toBe(true)
  })

  test('拒绝 success 缺失或类型不对的载荷', () => {
    expect(isApiEnvelope({})).toBe(false)
    expect(isApiEnvelope({ success: 'yes' })).toBe(false)
    expect(isApiEnvelope(null)).toBe(false)
    expect(isApiEnvelope([1, 2])).toBe(false)
    expect(isApiEnvelope('nope')).toBe(false)
  })

  test('拒绝缺 data 键的载荷，即使是 success=true', () => {
    // 服务端每条包络都写 data，缺 data 一定是坏响应。若放行，undefined 会流进
    // setData，一直到渲染层读 data.xxx 才炸——那时已经不是"解析失败"能兜住的了。
    expect(isApiEnvelope({ success: true })).toBe(false)
    expect(isApiEnvelope({ success: true, error: null })).toBe(false)
  })

  test('data 为 null 仍是合法包络', () => {
    expect(isApiEnvelope<number>({ success: true, data: null, error: null })).toBe(true)
  })

  test('收窄后可以直接读 data 而不需要 as 强转', () => {
    const payload: unknown = { success: true, data: { id: 'x' }, error: null }
    if (!isApiEnvelope<{ id: string }>(payload)) {
      throw new Error('应当收窄成功')
    }
    expect(payload.data?.id).toBe('x')
    expect(payload.error).toBeNull()
  })

  test('success=false 时 data 为 null 但仍是合法包络', () => {
    const payload: unknown = { success: false, data: null, error: '炸了' }
    expect(isApiEnvelope<number>(payload)).toBe(true)
  })
})

describe('错误文案', () => {
  test('httpStatusError 带上级别码', () => {
    expect(httpStatusError(404)).toBe('请求失败（HTTP 404）')
    expect(httpStatusError(500)).toBe('请求失败（HTTP 500）')
  })

  test('常量文案是中文可读的', () => {
    expect(NETWORK_ERROR.length).toBeGreaterThan(0)
    expect(MALFORMED_RESPONSE_ERROR).toContain('JSON')
    expect(UNKNOWN_API_ERROR).toContain('服务端')
  })
})
