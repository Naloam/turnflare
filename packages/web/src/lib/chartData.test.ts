import { describe, expect, test } from 'vitest'
import type { ModelStats, ProjectStats, Turn } from '../types/api'
import {
  makeCost,
  makeModelStats,
  makeProjectStats,
  makeTimeBucket,
  makeTurn,
  makeUsage,
} from '../test/fixtures'
import {
  shortModelName,
  toModelShares,
  toProjectCosts,
  toTrendPoints,
  toWaterfallPoints,
  totalTokens,
} from './chartData'

describe('totalTokens', () => {
  test('四类 token 相加', () => {
    expect(
      totalTokens(
        makeUsage({
          inputTokens: 1000,
          cacheCreationTokens: 200,
          cacheReadTokens: 300,
          outputTokens: 400,
        }),
      ),
    ).toBe(1900)
  })

  test('thinking 与 serverToolUse 不重复计数', () => {
    const usage = makeUsage({ thinkingTokens: 9999, serverToolUse: 9999 })
    expect(totalTokens(usage)).toBe(1200 + 300 + 400 + 250)
  })

  test('负值按 0 处理，不会把总量拖成负数', () => {
    expect(totalTokens(makeUsage({ inputTokens: -500 }))).toBe(300 + 400 + 250)
  })
})

describe('shortModelName', () => {
  test.each([
    { input: 'claude-sonnet-4-5-20250929', expected: 'claude-sonnet-4-5' },
    { input: 'claude-opus-4-1-20250805', expected: 'claude-opus-4-1' },
    { input: 'claude-3-5-haiku-20241022', expected: 'claude-3-5-haiku' },
    { input: 'gpt-4o', expected: 'gpt-4o' },
    { input: 'claude', expected: 'claude' },
    { input: '20250929', expected: '20250929' },
  ])('$input -> $expected', ({ input, expected }) => {
    expect(shortModelName(input)).toBe(expected)
  })
})

describe('toTrendPoints', () => {
  test('桶键转成月-日标签，成本取 totalCost', () => {
    const points = toTrendPoints([
      makeTimeBucket({ bucket: '2026-10-17T00:00:00Z', cost: makeCost({ totalCost: 1 }) }),
      makeTimeBucket({ bucket: '2026-10-19T00:00:00Z', cost: makeCost({ totalCost: 2.5 }) }),
    ])
    expect(points).toEqual([
      { date: '10-17', cost: 1 },
      { date: '10-19', cost: 2.5 },
    ])
  })

  test('桶键无法解析时原样保留', () => {
    const points = toTrendPoints([makeTimeBucket({ bucket: 'garbage' })])
    expect(points[0]?.date).toBe('garbage')
  })

  test('负成本夹紧为 0', () => {
    const points = toTrendPoints([makeTimeBucket({ cost: makeCost({ totalCost: -3 }) })])
    expect(points[0]?.cost).toBe(0)
  })

  test('空数组返回空数组', () => {
    expect(toTrendPoints([])).toEqual([])
  })
})

describe('toModelShares', () => {
  test('按成本降序并计算占比', () => {
    const models: readonly ModelStats[] = [
      makeModelStats({ model: 'a', cost: makeCost({ totalCost: 1 }) }),
      makeModelStats({ model: 'b', cost: makeCost({ totalCost: 3 }) }),
    ]
    const shares = toModelShares(models)
    expect(shares.map((share) => share.name)).toEqual(['b', 'a'])
    expect(shares[0]?.share).toBe(0.75)
    expect(shares[1]?.share).toBe(0.25)
  })

  test('总成本为 0 时占比全部记 0（不出现 NaN）', () => {
    const shares = toModelShares([
      makeModelStats({ model: 'a', cost: makeCost({ totalCost: 0 }) }),
      makeModelStats({ model: 'b', cost: makeCost({ totalCost: 0 }) }),
    ])
    expect(shares.every((share) => share.share === 0)).toBe(true)
  })

  test('不改写入参数组', () => {
    const models: readonly ModelStats[] = [
      makeModelStats({ model: 'a', cost: makeCost({ totalCost: 1 }) }),
      makeModelStats({ model: 'b', cost: makeCost({ totalCost: 9 }) }),
    ]
    toModelShares(models)
    expect(models.map((model) => model.model)).toEqual(['a', 'b'])
  })

  test('空数组返回空数组', () => {
    expect(toModelShares([])).toEqual([])
  })
})

describe('toWaterfallPoints', () => {
  test('只统计带 usage 的 assistant turn', () => {
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'u1', role: 'user', usage: null }),
      makeTurn({
        uuid: 'a1',
        role: 'assistant',
        usage: makeUsage({ inputTokens: 10, cacheReadTokens: 20, outputTokens: 30 }),
      }),
      makeTurn({ uuid: 'a2', role: 'assistant', usage: null }),
      makeTurn({
        uuid: 'a3',
        role: 'assistant',
        usage: makeUsage({ inputTokens: 1, cacheReadTokens: 2, outputTokens: 3 }),
      }),
    ]
    const points = toWaterfallPoints(turns)
    expect(points).toEqual([
      { label: '#1', inputTokens: 10, cacheReadTokens: 20, outputTokens: 30 },
      { label: '#2', inputTokens: 1, cacheReadTokens: 2, outputTokens: 3 },
    ])
  })

  test('没有 assistant turn 时返回空数组', () => {
    expect(toWaterfallPoints([makeTurn({ role: 'user', usage: null })])).toEqual([])
  })
})

describe('toProjectCosts', () => {
  test('按成本降序并带上 token 与会话数', () => {
    const projects: readonly ProjectStats[] = [
      makeProjectStats({
        projectSlug: 'low',
        cost: makeCost({ totalCost: 1 }),
        sessionCount: 2,
        usage: makeUsage({
          inputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
        }),
      }),
      makeProjectStats({
        projectSlug: 'high',
        cost: makeCost({ totalCost: 9 }),
        sessionCount: 5,
      }),
    ]
    const points = toProjectCosts(projects)
    expect(points.map((point) => point.project)).toEqual(['high', 'low'])
    expect(points[0]).toEqual({ project: 'high', cost: 9, tokens: 2150, sessions: 5 })
  })

  test('空数组返回空数组', () => {
    expect(toProjectCosts([])).toEqual([])
  })
})
