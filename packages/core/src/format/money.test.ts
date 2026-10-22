import { describe, expect, test } from 'vitest'
import { formatCost, formatCostCompact } from './money'

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

  test.each([
    { input: Number.NaN },
    { input: Number.POSITIVE_INFINITY },
    { input: Number.NEGATIVE_INFINITY },
  ])('非有限值 $input 返回 "-"', ({ input }) => {
    expect(formatCost(input)).toBe('-')
  })
})

describe('formatCostCompact', () => {
  test.each([
    { input: 0, expected: '$0.00' },
    { input: 0.5, expected: '$0.50' },
    { input: 999.99, expected: '$999.99' },
    { input: 1000, expected: '$1.0K' },
    { input: 1234.5, expected: '$1.2K' },
    { input: 1_500_000, expected: '$1.5M' },
  ])('把 $input 格式化为 $expected', ({ input, expected }) => {
    expect(formatCostCompact(input)).toBe(expected)
  })

  test('负数保留符号', () => {
    expect(formatCostCompact(-1234.5)).toBe('-$1.2K')
  })

  test('非有限值返回 "-"', () => {
    expect(formatCostCompact(Number.NaN)).toBe('-')
  })
})
