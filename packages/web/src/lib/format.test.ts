import { describe, expect, test } from 'vitest'
import {
  formatBytes,
  formatCost,
  formatDate,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatTokensDetailed,
  localTimezoneOffsetMinutes,
  UNAVAILABLE_TEXT,
} from './format'

/**
 * 这些用例与 packages/core/src/format/*.test.ts 一一对应。
 * 两侧实现是刻意重复的（web 不能 import core，core 依赖 node:fs），
 * 因此用例也必须同步：改一边的测试就要改另一边，否则前后端会同数不同形。
 */

/** 固定参考时刻，避免测试依赖真实当前时间 */
const NOW = new Date('2026-10-19T12:00:00.000Z')

describe('formatTokens', () => {
  test.each([
    { input: 0, expected: '0' },
    { input: 999, expected: '999' },
    { input: 1000, expected: '1K' },
    { input: 1050, expected: '1.1K' },
    { input: 40198, expected: '40.2K' },
    { input: 999999, expected: '1000K' },
    { input: 1500000, expected: '1.5M' },
    { input: 1234567, expected: '1.2M' },
    { input: 1_500_000_000, expected: '1.5B' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatTokens(input)).toBe(expected)
  })

  test('负数保留符号', () => {
    expect(formatTokens(-40198)).toBe('-40.2K')
    expect(formatTokens(-999)).toBe('-999')
  })

  test.each([
    { input: Number.NaN },
    { input: Number.POSITIVE_INFINITY },
    { input: Number.NEGATIVE_INFINITY },
  ])('非有限值 $input 返回 "-"', ({ input }) => {
    expect(formatTokens(input)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatTokensDetailed', () => {
  test.each([
    { input: 0, expected: '0' },
    { input: 999, expected: '999' },
    { input: 1000, expected: '1,000' },
    { input: 40198, expected: '40,198' },
    { input: 1234567, expected: '1,234,567' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatTokensDetailed(input)).toBe(expected)
  })

  test('小数部分被截断而非四舍五入', () => {
    expect(formatTokensDetailed(40198.9)).toBe('40,198')
  })

  test('负数保留符号', () => {
    expect(formatTokensDetailed(-40198)).toBe('-40,198')
  })

  test.each([
    { input: Number.NaN },
    { input: Number.POSITIVE_INFINITY },
    { input: Number.NEGATIVE_INFINITY },
  ])('非有限值 $input 返回 "-"', ({ input }) => {
    expect(formatTokensDetailed(input)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatCost', () => {
  test.each([
    { input: 0, expected: '$0.00' },
    { input: 0.004, expected: '$0.0040' },
    { input: 0.0099, expected: '$0.0099' },
    { input: 0.01, expected: '$0.01' },
    { input: 1.2345, expected: '$1.23' },
    { input: 1.235, expected: '$1.24' },
    { input: 0.5, expected: '$0.50' },
    { input: 1234.5, expected: '$1,234.50' },
    { input: 1234567.89, expected: '$1,234,567.89' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatCost(input)).toBe(expected)
  })

  test('负数保留符号', () => {
    expect(formatCost(-1.2345)).toBe('-$1.23')
    expect(formatCost(-0.004)).toBe('-$0.0040')
  })

  test('非有限值返回 "-"', () => {
    expect(formatCost(Number.NaN)).toBe(UNAVAILABLE_TEXT)
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatPercent', () => {
  test.each([
    { input: 0, expected: '0.0%' },
    { input: 1, expected: '100.0%' },
    { input: 0.8765, expected: '87.7%' },
    { input: 0.5, expected: '50.0%' },
    { input: 0.12345, digits: 2, expected: '12.35%' },
  ])('把 $input 格式化为 $expected', ({ input, digits, expected }) => {
    expect(formatPercent(input, digits)).toBe(expected)
  })

  test('默认保留 1 位小数', () => {
    expect(formatPercent(0.4237)).toBe('42.4%')
  })

  test('非有限值返回 "-"', () => {
    expect(formatPercent(Number.NaN)).toBe(UNAVAILABLE_TEXT)
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatBytes', () => {
  test.each([
    { input: 0, expected: '0 B' },
    { input: 512, expected: '512 B' },
    { input: 1024, expected: '1.0 KB' },
    { input: 1536, expected: '1.5 KB' },
    { input: 1048576, expected: '1.0 MB' },
    { input: 1610612736, expected: '1.5 GB' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatBytes(input)).toBe(expected)
  })

  test('负数与非有限值返回 "-"', () => {
    expect(formatBytes(-1)).toBe(UNAVAILABLE_TEXT)
    expect(formatBytes(Number.NaN)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatRelativeTime', () => {
  test.each([
    { iso: '2026-10-19T11:59:30.000Z', expected: '刚刚' },
    { iso: '2026-10-19T11:57:00.000Z', expected: '3 分钟前' },
    { iso: '2026-10-19T10:00:00.000Z', expected: '2 小时前' },
    { iso: '2026-10-18T12:00:00.000Z', expected: '昨天' },
    { iso: '2026-10-16T12:00:00.000Z', expected: '3 天前' },
  ])('$iso 相对 NOW 是 $expected', ({ iso, expected }) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected)
  })

  test('未来时间用"后"表达', () => {
    expect(formatRelativeTime('2026-10-19T12:30:00.000Z', NOW)).toBe('30 分钟后')
    expect(formatRelativeTime('2026-10-20T12:00:00.000Z', NOW)).toBe('明天')
  })

  test('超过阈值展示绝对日期', () => {
    expect(formatRelativeTime('2026-10-01T12:00:00.000Z', NOW)).toBe('2026-10-01')
  })

  test('非法输入返回 "-"', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe(UNAVAILABLE_TEXT)
    expect(formatRelativeTime('', NOW)).toBe(UNAVAILABLE_TEXT)
  })
})

describe('formatDateTime 与 formatDate', () => {
  test('默认按 UTC 展示', () => {
    expect(formatDateTime('2026-10-19T08:25:26.923Z')).toBe('2026-10-19 08:25')
  })

  test('按东八区偏移展示', () => {
    expect(formatDateTime('2026-10-19T08:25:26.923Z', 480)).toBe('2026-10-19 16:25')
  })

  test('负偏移跨天', () => {
    expect(formatDateTime('2026-10-19T02:00:00.000Z', -300)).toBe('2026-10-18 21:00')
  })

  test('formatDate 按偏移返回本地日期', () => {
    expect(formatDate('2026-10-19T20:00:00.000Z', 480)).toBe('2026-10-20')
  })

  test('非法输入返回 "-"', () => {
    expect(formatDateTime('nope')).toBe(UNAVAILABLE_TEXT)
    expect(formatDate('nope')).toBe(UNAVAILABLE_TEXT)
  })
})

describe('localTimezoneOffsetMinutes', () => {
  test('UTC 环境下返回 0', () => {
    // 构造一个 getTimezoneOffset 恒为 0 的 Date，避免测试机时区影响结果
    const utcDate = new Date('2026-10-19T12:00:00.000Z')
    utcDate.getTimezoneOffset = () => 0
    expect(localTimezoneOffsetMinutes(utcDate)).toBe(0)
  })

  test('东八区返回 480（与 Date.getTimezoneOffset 符号相反）', () => {
    const date = new Date('2026-10-19T12:00:00.000Z')
    date.getTimezoneOffset = () => -480
    expect(localTimezoneOffsetMinutes(date)).toBe(480)
  })
})
