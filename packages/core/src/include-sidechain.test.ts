import { describe, expect, test } from 'vitest'
import { aggregate } from './stats/aggregate.js'
import { costOf } from './cost/calculate.js'
import type { Session, TokenUsage, Turn } from './types.js'

/**
 * `includeSidechain` 的不变量测试。
 *
 * 为什么单独一个文件：这个选项原本只是 aggregate 的一个可选参数，现在被 api 侧
 * 的侧链汇总功能依赖（`readSidechainSummary` 用它拿"全量"口径），已经是契约的
 * 一部分。而 core 自己的测试只有两条粗测——一旦它回归，api 的侧链数字会静默
 * 变错，且没有任何测试能拦。
 *
 * 核心不变量：**同一份数据，`includeSidechain: true` 的每个字段都要
 * >= 默认（false）的对应字段**，且差额恰好等于侧链那部分。
 */

const MAIN_MODEL = 'claude-opus-5-5'

function turn(uuid: string, isSidechain: boolean, inputTokens: number, outputTokens: number): Turn {
  return {
    uuid,
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:00:00.000Z',
    model: MAIN_MODEL,
    usage: {
      speed: 'standard',
      inputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens,
      thinkingTokens: 0,
      serverToolUse: 0,
    },
    tools: [],
    textPreview: '',
    isSidechain,
    lineNumber: 1,
  }
}

function makeSession(turns: readonly Turn[]): Session {
  return {
    meta: {
      sessionId: 'sess-inv',
      filePath: '/tmp/sess-inv.jsonl',
      projectSlug: 'inv',
      cwd: null,
      gitBranch: null,
      cliVersion: null,
      startedAt: '2026-10-19T08:00:00.000Z',
      endedAt: '2026-10-19T09:00:00.000Z',
      models: [MAIN_MODEL],
    },
    turns,
    records: [],
    parseErrors: [],
  }
}

/** 一场主链 2 条 + 侧链 3 条的会话 */
const MIXED = makeSession([
  turn('m-1', false, 1000, 100),
  turn('m-2', false, 2000, 200),
  turn('s-1', true, 10000, 1000),
  turn('s-2', true, 20000, 2000),
  turn('s-3', true, 30000, 3000),
])

describe('includeSidechain 的不变量', () => {
  test('默认排除侧链', () => {
    const stats = aggregate([MIXED])

    expect(stats.turnCount).toBe(2)
    expect(stats.usage.inputTokens).toBe(3000)
    expect(stats.usage.outputTokens).toBe(300)
    expect(stats.sessionCount).toBe(1)
  })

  test('开启后计入侧链', () => {
    const stats = aggregate([MIXED], { includeSidechain: true })

    expect(stats.turnCount).toBe(5)
    expect(stats.usage.inputTokens).toBe(63000)
    expect(stats.usage.outputTokens).toBe(6300)
    // 会话数不变：侧链不产生新会话
    expect(stats.sessionCount).toBe(1)
  })

  test('差额恰好等于侧链部分', () => {
    const main = aggregate([MIXED])
    const all = aggregate([MIXED], { includeSidechain: true })
    const sideOnly = aggregate([makeSession(MIXED.turns.filter((t) => t.isSidechain))], {
      includeSidechain: true,
    })

    // all - main == sideOnly，三个数字必须严格对得上
    expect(all.usage.inputTokens - main.usage.inputTokens).toBe(sideOnly.usage.inputTokens)
    expect(all.usage.outputTokens - main.usage.outputTokens).toBe(sideOnly.usage.outputTokens)
    expect(all.turnCount - main.turnCount).toBe(sideOnly.turnCount)
  })

  test('成本差额同样精确（侧链单独计价）', () => {
    // 必须显式装配 costCalculator：aggregate 默认不算钱（cost 全 0），
    // 不装的话这条断言会恒真，什么都验证不到
    const calc = (usage: TokenUsage, model: string) => costOf({ usage, model })
    const main = aggregate([MIXED], { costCalculator: calc })
    const all = aggregate([MIXED], { costCalculator: calc, includeSidechain: true })

    // 侧链 3 条：60000 输入 × $4/M = $0.24；6000 输出 × $20/M = $0.12
    const expectedSideCost = costOf({
      usage: {
        speed: 'standard',
        inputTokens: 60000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 6000,
        thinkingTokens: 0,
        serverToolUse: 0,
      },
      model: MAIN_MODEL,
    }).totalCost

    expect(all.cost.totalCost - main.cost.totalCost).toBeCloseTo(expectedSideCost, 10)
    expect(expectedSideCost).toBeCloseTo(0.36, 10)
  })

  test('byModel 也随选项切换', () => {
    const main = aggregate([MIXED])
    const all = aggregate([MIXED], { includeSidechain: true })

    // 同一个模型，请求数从 2 变 5
    expect(main.byModel[0]?.requestCount).toBe(2)
    expect(all.byModel[0]?.requestCount).toBe(5)
  })

  test('没有侧链时两个选项结果完全相同', () => {
    const pureMain = makeSession(MIXED.turns.filter((t) => !t.isSidechain))

    expect(aggregate([pureMain], { includeSidechain: true })).toEqual(aggregate([pureMain]))
  })

  test('全是侧链时默认口径为空壳但结构合法', () => {
    const pureSide = makeSession(MIXED.turns.filter((t) => t.isSidechain))

    const main = aggregate([pureSide])
    expect(main.turnCount).toBe(0)
    expect(main.sessionCount).toBe(0)
    expect(main.usage.inputTokens).toBe(0)
    // 结构仍然合法：不会抛错，byModel/byHour 都是空数组
    expect(main.byModel).toEqual([])
    expect(main.byHour).toEqual([])

    const all = aggregate([pureSide], { includeSidechain: true })
    expect(all.turnCount).toBe(3)
    expect(all.sessionCount).toBe(1)
  })

  test('since/until 与 includeSidechain 叠加时互不干扰', () => {
    // 时间窗口过滤侧链，includeSidechain 决定"侧链算不算"——两个维度独立
    const windowed = aggregate([MIXED], {
      includeSidechain: true,
      since: '2026-10-19T08:30:00.000Z',
    })

    // 所有 turn 时间戳都早于 08:30，全被窗口排除
    expect(windowed.turnCount).toBe(0)

    const noWindow = aggregate([MIXED], { includeSidechain: true })
    expect(noWindow.turnCount).toBe(5)
  })

  test('空会话数组在两种选项下都合法', () => {
    expect(aggregate([]).turnCount).toBe(0)
    expect(aggregate([], { includeSidechain: true }).turnCount).toBe(0)
  })
})
