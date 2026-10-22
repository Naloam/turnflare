import { describe, expect, test, vi } from 'vitest'
import { formatLocalDateTime } from './format'

/**
 * DST 回归测试。
 *
 * 曾经的病灶：展示层用 `formatDateTime(iso, localTimezoneOffsetMinutes())` 把
 * 时间戳渲染成本地时间。localTimezoneOffsetMinutes() 只能给出**当前时刻**的
 * 偏移，把它套到几个月前的时间戳上，遇到夏令时切换就偏差一小时——7 月的 EDT
 * 是 -240，11 月的 EST 是 -300，拿冬季偏移渲染夏季时刻，墙钟就错了。
 *
 * 因此这里守两条不变量：
 *   1. 渲染结果不随"现在"变化（固定偏移方案会随调用日期漂移）；
 *   2. 与平台 Intl 对系统时区的计算结果一致（Intl 按每个瞬间各自判断 DST）。
 */

/** 平台 Intl 对系统时区算出的真实墙钟——这是"正确答案"的定义 */
function systemWallClock(iso: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const field = (type: string): string => parts.find((part) => part.type === type)?.value ?? '??'
  return `${field('year')}-${field('month')}-${field('day')} ${field('hour')}:${field('minute')}`
}

/** 某个时区在指定时刻的 UTC 偏移（分钟，东为正） */
function offsetOf(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const field = (type: string): string => parts.find((part) => part.type === type)?.value ?? '0'
  const asUtc = Date.UTC(
    Number(field('year')),
    Number(field('month')) - 1,
    Number(field('day')),
    Number(field('hour')),
    Number(field('minute')),
    Number(field('second')),
  )
  return Math.round((asUtc - at.getTime()) / 60000)
}

const SUMMER = '2026-07-15T14:00:00.000Z'
const WINTER = '2026-01-15T15:00:00.000Z'
const SPRING_FORWARD = '2026-03-08T07:30:00.000Z'
const FALL_BACK = '2026-11-01T06:30:00.000Z'

describe('formatLocalDateTime 的 DST 行为', () => {
  test.each([SUMMER, WINTER, SPRING_FORWARD, FALL_BACK])(
    '%s 与平台 Intl 的系统时区结果一致',
    (iso) => {
      expect(formatLocalDateTime(iso)).toBe(systemWallClock(iso))
    },
  )

  test('渲染结果不随当前时刻漂移', () => {
    // 固定偏移方案的病灶就在这：偏移取自"现在"，于是同一输入在不同日期
    // 调用会得到不同输出。按瞬间各自判断时区的实现不该有任何差异。
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))
      const fromWinter = formatLocalDateTime(SUMMER)
      vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'))
      const fromSummer = formatLocalDateTime(SUMMER)
      expect(fromWinter).toBe(fromSummer)
    } finally {
      vi.useRealTimers()
    }
  })

  test('固定偏移方案在 DST 边界上确实会错（记录为什么不能用它）', () => {
    // 用纽约时区演示：同一年的偏移量差一小时。这不是在测实现，而是在固化
    // "为什么 formatDateTime(iso, localTimezoneOffsetMinutes()) 是错的"这个
    // 判断依据，以免将来有人再把那条路加回来。
    const newYorkSummer = offsetOf('America/New_York', new Date(SUMMER))
    const newYorkWinter = offsetOf('America/New_York', new Date(WINTER))
    // 东为正，所以 EST(-300) 减 EDT(-240) 得 -60；取绝对值只看差值大小
    expect(Math.abs(newYorkWinter - newYorkSummer)).toBe(60)

    // 拿冬季偏移去渲染夏季时刻：结果比真实墙钟早一小时
    const shifted = new Date(new Date(SUMMER).getTime() + newYorkWinter * 60000)
    const wrong = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(shifted)
    const truth = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(SUMMER))
    expect(wrong).not.toBe(truth)
  })

  test('非法输入返回 "-"', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('-')
    expect(formatLocalDateTime('')).toBe('-')
  })
})
