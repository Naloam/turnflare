import { describe, expect, test } from 'vitest'
import { formatTokens, formatTokensDetailed } from './tokens'

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
    { input: Number.NaN, expected: '-' },
    { input: Number.POSITIVE_INFINITY, expected: '-' },
    { input: Number.NEGATIVE_INFINITY, expected: '-' },
  ])('非有限值 $input 返回 "-"', ({ input, expected }) => {
    expect(formatTokens(input)).toBe(expected)
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

  test('非有限值返回 "-"', () => {
    expect(formatTokensDetailed(Number.NaN)).toBe('-')
    expect(formatTokensDetailed(Number.POSITIVE_INFINITY)).toBe('-')
  })
})
