import { describe, expect, test } from 'vitest'
import {
  formatBytes,
  formatCompactNumber,
  formatPercent,
  formatWithThousandsSeparator,
} from './numbers'

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

  test('非有限值返回 "-"', () => {
    expect(formatPercent(Number.NaN)).toBe('-')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('-')
  })
})

describe('formatCompactNumber', () => {
  test.each([
    { input: 0, expected: '0' },
    { input: 999, expected: '999' },
    { input: 12345, expected: '12.3K' },
    { input: 1_500_000, expected: '1.5M' },
    { input: 2_500_000_000, expected: '2.5B' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatCompactNumber(input)).toBe(expected)
  })

  test('非有限值返回 "-"', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('-')
  })
})

describe('formatWithThousandsSeparator', () => {
  test.each([
    { input: 0, expected: '0' },
    { input: 40198, expected: '40,198' },
    { input: 1234567, expected: '1,234,567' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatWithThousandsSeparator(input)).toBe(expected)
  })

  test('非有限值返回 "-"', () => {
    expect(formatWithThousandsSeparator(Number.NaN)).toBe('-')
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
    expect(formatBytes(-1)).toBe('-')
    expect(formatBytes(Number.NaN)).toBe('-')
  })
})
