import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseSessionFile } from './parser/session.js'
import { aggregate } from './stats/aggregate.js'
import { costOf } from './cost/calculate.js'

/**
 * fast 档计价的端到端回归。
 *
 * 曾经的缺陷：`normalizeUsage` 不读 `usage.speed`，解析出来的 TokenUsage 没有
 * 档位信息，于是整条链（解析 → Turn → aggregate → costOf）都把 fast 请求按
 * 标准价计。fast 档单价约为标准档 2 倍，等于成本低估一半。
 */

const FAST_MODEL = 'claude-opus-5-5'

/** 造一条带指定 speed 的 assistant 记录 */
function assistantLine(sessionId: string, speed: string | undefined): string {
  const usage: Record<string, unknown> = {
    input_tokens: 1_000_000,
    output_tokens: 1000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  }
  if (speed !== undefined) {
    usage.speed = speed
  }
  return JSON.stringify({
    type: 'assistant',
    uuid: `${sessionId}-a1`,
    sessionId,
    timestamp: '2026-10-19T08:00:00.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      model: FAST_MODEL,
      content: [{ type: 'text', text: 'hi' }],
      usage,
    },
  })
}

function writeSession(speed: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'turnflare-speed-'))
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 's.jsonl')
  writeFileSync(filePath, `${assistantLine('sess-speed', speed)}\n`, 'utf8')
  return filePath
}

describe('fast 档计价端到端', () => {
  let filePath: string

  beforeEach(() => {
    filePath = writeSession('fast')
  })

  afterEach(() => {
    rmSync(join(filePath, '..'), { recursive: true, force: true })
  })

  test('解析出的 usage 携带 speed 档位', () => {
    const session = parseSessionFile(filePath)
    const turn = session.turns.find((item) => item.usage !== null)
    expect(turn?.usage?.speed).toBe('fast')
  })

  test('fast 档按 fast 价计，是标准价的约 2 倍', () => {
    const session = parseSessionFile(filePath)
    const turn = session.turns.find((item) => item.usage !== null)
    if (turn?.usage === null || turn?.usage === undefined) {
      throw new Error('夹具里应该有一条带用量的 turn')
    }

    const fast = costOf({ usage: turn.usage, model: FAST_MODEL })
    const standard = costOf({ usage: { ...turn.usage, speed: 'standard' }, model: FAST_MODEL })

    expect(fast.inputCost).toBeCloseTo(8, 10)
    // 1000 个输出 token × $40/MTok = $0.04
    expect(fast.outputCost).toBeCloseTo(0.04, 10)
    expect(standard.inputCost).toBeCloseTo(4, 10)
    // fast 总价 8.04、标准总价 4.02，差价 4.02——这就是当初被低估的那一半
    expect(fast.totalCost).toBeCloseTo(8.04, 6)
    expect(standard.totalCost).toBeCloseTo(4.02, 6)
    expect(fast.totalCost - standard.totalCost).toBeCloseTo(4.02, 6)
  })

  test('aggregate 装配 costCalculator 后 fast 档如实反映在总成本里', () => {
    const session = parseSessionFile(filePath)
    // 内联计算器：core 不导出 costCalculator（那是 api 包的装配），
    // 测试自己接一条更直接
    const stats = aggregate([session], {
      costCalculator: (usage, model) => costOf({ usage, model }),
    })

    expect(stats.cost.totalCost).toBeCloseTo(8.04, 6)
    expect(stats.cost.unpricedModel).toBe(false)
    expect(stats.byModel[0]?.cost.totalCost).toBeCloseTo(8.04, 6)
  })

  test('缺 speed 字段的旧记录按标准档计', () => {
    const legacyPath = writeSession(undefined)
    try {
      const session = parseSessionFile(legacyPath)
      const turn = session.turns.find((item) => item.usage !== null)
      // "没有标记"不等于 fast：旧版本记录没有这个字段，按标准档才是对的
      expect(turn?.usage?.speed).toBe('standard')
      expect(
        costOf({
          usage: turn?.usage ?? {
            speed: 'standard',
            inputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
            thinkingTokens: 0,
            serverToolUse: 0,
          },
          model: FAST_MODEL,
        }).inputCost,
      ).toBeCloseTo(4, 10)
    } finally {
      rmSync(join(legacyPath, '..'), { recursive: true, force: true })
    }
  })

  test('显式 speed 入参优先于 usage 自带的档位', () => {
    const session = parseSessionFile(filePath)
    const turn = session.turns.find((item) => item.usage !== null)
    if (turn?.usage === null || turn?.usage === undefined) {
      throw new Error('夹具里应该有一条带用量的 turn')
    }
    // usage 说 fast，但调用方显式要求 standard——以调用方为准
    const forced = costOf({ usage: turn.usage, model: FAST_MODEL, speed: 'standard' })
    expect(forced.inputCost).toBeCloseTo(4, 10)
  })
})
