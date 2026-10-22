import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseSessionFile } from './parser/session.js'
import { aggregate } from './stats/aggregate.js'
import { bucketByDay, bucketByHour } from './stats/bucket.js'
import { aggregateTools } from './stats/tools.js'
import { costOf, costOfWithSplit, sumCosts } from './cost/calculate.js'
import { dedupeTurns } from './stats/dedupe.js'
import { formatTokens, formatCost, formatPercent } from './format/index.js'
import type { Session, TokenUsage, Turn } from './types.js'

/**
 * 鲁棒性测试：用确定性的伪随机脏数据轰炸整条引擎链路。
 *
 * 要守住的不变量只有一条，但它是这个项目的立身之本——
 * **jsonl 里什么都有，任何输入都不该让引擎抛错，也不该产出 NaN 或负成本**。
 * 会话文件可能被写一半、可能混进插件遥测、字段可能缺可能错类型。
 *
 * 随机数用线性同余而不是 Math.random：失败时必须能靠同一个种子复现。
 */

const FUZZ_SEED = 20261019
const FUZZ_ROUNDS = 200

/** 线性同余发生器；同一个 seed 必然产出同一串数 */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

/** 脏数据池：故意混入 null / undefined / 字符串 / NaN / Infinity / 嵌套错误 */
const DIRTY_VALUES: readonly unknown[] = [
  null,
  undefined,
  '',
  'not-a-number',
  '  ',
  0,
  -1,
  -9999,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  true,
  false,
  [],
  {},
  [1, 'two', null],
  { nested: { deeper: null } },
  Symbol('dirty'),
  Number.MAX_SAFE_INTEGER + 2,
  0.0000001,
]

function pickDirty(random: () => number): unknown {
  const index = Math.floor(random() * DIRTY_VALUES.length)
  return DIRTY_VALUES[index] ?? null
}

/** 造一条字段随机错乱的 turn */
function makeDirtyTurn(random: () => number, index: number): Turn {
  const usageOrNot = random() < 0.75
  return {
    uuid: random() < 0.1 ? '' : `turn-${index}`,
    parentUuid: pickDirty(random) as string | null,
    role: random() < 0.5 ? 'user' : 'assistant',
    timestamp: random() < 0.2 ? (pickDirty(random) as string) : '2026-10-19T08:00:00.000Z',
    model: random() < 0.3 ? (pickDirty(random) as string | null) : 'claude-opus-5-5',
    usage: usageOrNot
      ? {
          speed: 'standard' as const,
          inputTokens: pickDirty(random) as number,
          cacheCreationTokens: pickDirty(random) as number,
          cacheReadTokens: pickDirty(random) as number,
          outputTokens: pickDirty(random) as number,
          thinkingTokens: pickDirty(random) as number,
          serverToolUse: pickDirty(random) as number,
        }
      : null,
    tools:
      random() < 0.3
        ? [
            {
              toolName: pickDirty(random) as string,
              toolUseId: `tool-${index}`,
              isError: random() < 0.5,
              resultBytes: pickDirty(random) as number,
            },
          ]
        : [],
    textPreview: pickDirty(random) as string,
    isSidechain: random() < 0.2,
    lineNumber: pickDirty(random) as number,
  }
}

function makeDirtySession(random: () => number): Session {
  const turnCount = Math.floor(random() * 8)
  return {
    meta: {
      sessionId: random() < 0.15 ? (pickDirty(random) as string) : 'sess-fuzz',
      filePath: '/tmp/fuzz.jsonl',
      projectSlug: pickDirty(random) as string,
      cwd: pickDirty(random) as string | null,
      gitBranch: pickDirty(random) as string | null,
      cliVersion: pickDirty(random) as string | null,
      startedAt: pickDirty(random) as string | null,
      endedAt: pickDirty(random) as string | null,
      models: random() < 0.5 ? ['claude-opus-5-5'] : [],
    },
    turns: Array.from({ length: turnCount }, (_, index) => makeDirtyTurn(random, index)),
    records: [],
    parseErrors: [],
  }
}

/** 断言一次成本结果是"健全"的：有限、非负、分项之和等于总额 */
function expectSaneCost(cost: {
  inputCost: number
  outputCost: number
  cacheWriteCost: number
  cacheReadCost: number
  totalCost: number
}): void {
  const parts = [
    cost.inputCost,
    cost.outputCost,
    cost.cacheWriteCost,
    cost.cacheReadCost,
    cost.totalCost,
  ]
  for (const part of parts) {
    expect(Number.isFinite(part)).toBe(true)
    expect(part).toBeGreaterThanOrEqual(0)
  }
  const summed = cost.inputCost + cost.outputCost + cost.cacheWriteCost + cost.cacheReadCost
  expect(cost.totalCost).toBeCloseTo(summed, 10)
}

describe('引擎鲁棒性（确定性模糊测试）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'turnflare-fuzz-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('脏 turn 数据不会让聚合抛错，也不会产出 NaN 或负成本', () => {
    const random = makeRandom(FUZZ_SEED)

    for (let round = 0; round < FUZZ_ROUNDS; round += 1) {
      const sessions = Array.from({ length: 3 }, () => makeDirtySession(random))
      const withCalculator = aggregate(sessions, {
        costCalculator: (usage, model) => costOf({ usage, model }),
      })
      const withoutCalculator = aggregate(sessions)

      for (const stats of [withCalculator, withoutCalculator]) {
        expectSaneCost(stats.cost)
        expect(Number.isFinite(stats.cacheHitRate)).toBe(true)
        expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0)
        expect(stats.cacheHitRate).toBeLessThanOrEqual(1)
        expect(Number.isFinite(stats.errorRate)).toBe(true)
        expect(stats.errorRate).toBeGreaterThanOrEqual(0)
        expect(stats.turnCount).toBeGreaterThanOrEqual(0)
        for (const model of stats.byModel) {
          expectSaneCost(model.cost)
        }
        for (const project of stats.byProject) {
          expectSaneCost(project.cost)
        }
        for (const bucket of [...stats.byHour, ...stats.byDay]) {
          expectSaneCost(bucket.cost)
        }
        for (const tool of stats.toolUsage) {
          expect(tool.callCount).toBeGreaterThanOrEqual(0)
          expect(tool.errorCount).toBeGreaterThanOrEqual(0)
          expect(tool.errorCount).toBeLessThanOrEqual(tool.callCount)
          expect(tool.totalResultBytes).toBeGreaterThanOrEqual(0)
        }
      }

      // 时间分桶与去重同样不能抛
      const turns = sessions.flatMap((session) => session.turns)
      expect(() => bucketByHour(turns)).not.toThrow()
      expect(() => bucketByDay(turns, 480)).not.toThrow()
      expect(() => aggregateTools(turns)).not.toThrow()
      expect(() => dedupeTurns(turns)).not.toThrow()
    }
  })

  test('脏 usage 数据不会让成本引擎产出 NaN 或负数', () => {
    const random = makeRandom(FUZZ_SEED + 1)

    for (let round = 0; round < FUZZ_ROUNDS; round += 1) {
      const usage: TokenUsage = {
        speed: 'standard',
        inputTokens: pickDirty(random) as number,
        cacheCreationTokens: pickDirty(random) as number,
        cacheReadTokens: pickDirty(random) as number,
        outputTokens: pickDirty(random) as number,
        thinkingTokens: pickDirty(random) as number,
        serverToolUse: pickDirty(random) as number,
      }
      const models = ['claude-opus-5-5', 'claude-haiku-4-5', 'no-such-model', '']
      const model = models[Math.floor(random() * models.length)] ?? ''

      expectSaneCost(costOf({ usage, model }))
      expectSaneCost(
        costOfWithSplit(
          { usage, model, speed: random() < 0.5 ? 'fast' : 'standard' },
          {
            ephemeral1h: pickDirty(random) as number,
            ephemeral5m: pickDirty(random) as number,
          },
        ),
      )
      expectSaneCost(sumCosts([costOf({ usage, model }), costOf({ usage, model })]))
    }
  })

  test('畸形与截断的 jsonl 行不会让解析抛错', () => {
    const random = makeRandom(FUZZ_SEED + 2)
    const projectDir = join(root, 'fuzz-project')
    mkdirSync(projectDir, { recursive: true })

    const fragments: string[] = [
      '',
      '{',
      '}',
      'null',
      '[]',
      '"a string"',
      '42',
      '{"type":"user"}',
      '{"type":"assistant","message":{"role":"assistant","model":null}}',
      '{"type":"user","message":{"role":"user","content":"半行',
      '{"type":"unknown-type","whatever":true}',
      '{"type":"user","message":{"role":"user"},"sessionId":"s"}',
      'not json at all',
      '{"type":"user","uuid":"u1","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"sessionId":"s1","timestamp":"2026-10-19T08:00:00.000Z"}',
    ]

    const lineCount = 40
    const lines: string[] = []
    for (let index = 0; index < lineCount; index += 1) {
      const pick = Math.floor(random() * fragments.length)
      lines.push(fragments[pick] ?? '')
    }
    // 最后一行故意不带换行符：模拟"正在写入时被读取"
    const filePath = join(projectDir, 'fuzz.jsonl')
    writeFileSync(filePath, lines.join('\n'), 'utf8')

    expect(() => parseSessionFile(filePath)).not.toThrow()

    const session = parseSessionFile(filePath)
    expect(session.parseErrors.length).toBeGreaterThan(0)
    expect(Array.isArray(session.turns)).toBe(true)
    expect(() => aggregate([session])).not.toThrow()
  })

  test('深度嵌套的 tool_result 不会让解析抛错', () => {
    // JSON.stringify 对几千层嵌套的对象会抛 RangeError（调用栈溢出）。
    // 体积只是展示统计，绝不能为它让整场会话解析失败。
    // 夹具也必须手工拼：用 stringify 构造它自己就会先溢出。
    const projectDir = join(root, 'deep')
    mkdirSync(projectDir, { recursive: true })

    const depth = 20000
    const nested = `${'{"nested":'.repeat(depth)}true${'}'.repeat(depth)}`
    const line =
      `{"type":"user","uuid":"u-deep","sessionId":"sess-deep",` +
      `"timestamp":"2026-10-19T08:00:00.000Z","message":{"role":"user",` +
      `"content":[{"type":"tool_result","tool_use_id":"tool-deep","content":${nested}}]}}`
    writeFileSync(join(projectDir, 'deep.jsonl'), `${line}\n`, 'utf8')

    expect(() => parseSessionFile(join(projectDir, 'deep.jsonl'))).not.toThrow()
    const session = parseSessionFile(join(projectDir, 'deep.jsonl'))
    expect(session.parseErrors).toEqual([])
    expect(session.turns.length).toBeGreaterThan(0)
    expect(() => aggregateTools(session.turns)).not.toThrow()
  })

  test('格式化函数对任何脏数字都返回可渲染的字符串', () => {
    const random = makeRandom(FUZZ_SEED + 3)

    for (let round = 0; round < FUZZ_ROUNDS; round += 1) {
      const value = pickDirty(random) as number
      for (const formatted of [formatTokens(value), formatCost(value), formatPercent(value)]) {
        expect(typeof formatted).toBe('string')
        expect(formatted.length).toBeGreaterThan(0)
        expect(formatted).not.toContain('NaN')
        expect(formatted).not.toContain('Infinity')
        expect(isRenderable(formatted)).toBe(true)
      }
    }
  })
})

/**
 * 结果必须能直接塞进终端或页面：不含控制字符，也没有未替换的占位符。
 * 用码点判断而不是正则——正则里写控制字符范围可读性太差。
 */
function isRenderable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return !text.includes('undefined')
}
