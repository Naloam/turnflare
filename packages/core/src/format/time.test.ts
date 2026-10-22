import { describe, expect, test } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatDurationPrecise,
  formatHourBucket,
  relativeTime,
} from './time'

/** 固定参考时刻，避免测试依赖真实当前时间 */
const NOW = new Date('2026-10-19T12:00:00.000Z')

describe('formatDuration', () => {
  test.each([
    { input: 0, expected: '0s' },
    { input: 999, expected: '0s' },
    { input: 1000, expected: '1s' },
    { input: 45000, expected: '45s' },
    { input: 59999, expected: '59s' },
    { input: 60000, expected: '1m 0s' },
    { input: 90000, expected: '1m 30s' },
    { input: 3599999, expected: '59m 59s' },
    { input: 3600000, expected: '1h 0m' },
    { input: 5400000, expected: '1h 30m' },
    { input: 86400000, expected: '1d 0h' },
    { input: 183600000, expected: '2d 3h' },
  ])('把 $input ms 格式化为 $expected', ({ input, expected }) => {
    expect(formatDuration(input)).toBe(expected)
  })

  test('负数返回 "-"', () => {
    expect(formatDuration(-1)).toBe('-')
  })

  test('非有限值返回 "-"', () => {
    expect(formatDuration(Number.NaN)).toBe('-')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('-')
  })
})

describe('formatDurationPrecise', () => {
  test.each([
    { input: 0, expected: '0:00' },
    { input: 9000, expected: '0:09' },
    { input: 90000, expected: '1:30' },
    { input: 3599000, expected: '59:59' },
    { input: 3600000, expected: '1:00:00' },
    { input: 3661000, expected: '1:01:01' },
  ])('把 $input ms 格式化为 $expected', ({ input, expected }) => {
    expect(formatDurationPrecise(input)).toBe(expected)
  })

  test('负数与非有限值返回 "-"', () => {
    expect(formatDurationPrecise(-1)).toBe('-')
    expect(formatDurationPrecise(Number.NaN)).toBe('-')
  })
})

describe('relativeTime', () => {
  test.each([
    { iso: '2026-10-19T11:59:30.000Z', expected: '刚刚' },
    { iso: '2026-10-19T11:57:00.000Z', expected: '3 分钟前' },
    { iso: '2026-10-19T10:00:00.000Z', expected: '2 小时前' },
    { iso: '2026-10-18T12:00:00.000Z', expected: '昨天' },
    { iso: '2026-10-16T12:00:00.000Z', expected: '3 天前' },
  ])('$iso 相对 NOW 是 $expected', ({ iso, expected }) => {
    expect(relativeTime(iso, NOW)).toBe(expected)
  })

  test('未来时间用"后"表达', () => {
    expect(relativeTime('2026-10-19T12:30:00.000Z', NOW)).toBe('30 分钟后')
    expect(relativeTime('2026-10-20T12:00:00.000Z', NOW)).toBe('明天')
  })

  test('超过阈值展示绝对日期', () => {
    expect(relativeTime('2026-10-01T12:00:00.000Z', NOW)).toBe('2026-10-01')
  })

  test('非法输入返回 "-"', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('-')
    expect(relativeTime('', NOW)).toBe('-')
  })
})

describe('formatDateTime', () => {
  test('默认按 UTC 展示', () => {
    expect(formatDateTime('2026-10-19T08:25:26.923Z')).toBe('2026-10-19 08:25')
  })

  test('按东八区偏移展示', () => {
    expect(formatDateTime('2026-10-19T08:25:26.923Z', 480)).toBe('2026-10-19 16:25')
  })

  test('负偏移跨天', () => {
    expect(formatDateTime('2026-10-19T02:00:00.000Z', -300)).toBe('2026-10-18 21:00')
  })

  test('非法输入返回 "-"', () => {
    expect(formatDateTime('nope')).toBe('-')
  })
})

describe('formatDate 与 formatHourBucket', () => {
  test('formatDate 按偏移返回本地日期', () => {
    expect(formatDate('2026-10-19T20:00:00.000Z', 480)).toBe('2026-10-20')
  })

  test('formatHourBucket 对齐到整点', () => {
    expect(formatHourBucket('2026-10-19T08:47:12.000Z')).toBe('2026-10-19T08:00:00Z')
    expect(formatHourBucket('2026-10-19T08:47:12.000Z', 480)).toBe('2026-10-19T16:00:00Z')
  })

  test('非法输入返回 "-"', () => {
    expect(formatDate('nope')).toBe('-')
    expect(formatHourBucket('nope')).toBe('-')
  })
})
