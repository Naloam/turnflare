/**
 * 侧链（subagent）汇总的测试。
 *
 * 单独一个文件而不是塞进 repository.test.ts：那个文件已经贴近行数上限，而这个
 * 特性最需要被单独读懂——它要证明的核心事实是"侧链被汇总上报，同时主链口径
 * 一个字都没变"。夹具与主链测试同源（repository-fixtures.ts），两边的默认
 * usage 永远是同一个，断言数字才不会互相矛盾。
 */

import type { TokenUsage, Turn } from '@turnflare/core'
import { afterAll, describe, expect, it } from 'vitest'
import type { SessionRepository } from './repository.js'
import {
  BASE_USAGE,
  closeOpenedDatabases,
  makeSession,
  makeStamp,
  makeTurn,
  openRepo,
  openRepoWithDb,
} from '../test-support/repository-fixtures.js'

afterAll(() => {
  closeOpenedDatabases()
})

describe('sidechain summary', () => {
  /**
   * 一场主链 + 侧链混合的会话。
   *
   * 侧链那两条的 token 刻意取整百，方便手算期望值；user 消息的 usage 为 null，
   * 用来验证"轮数算它、请求数不算它"。
   */
  function seedMixedSession(repo: SessionRepository): void {
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'main-1', lineNumber: 1 }),
      makeTurn({ uuid: 'main-2', lineNumber: 2 }),
      makeTurn({
        uuid: 'side-1',
        lineNumber: 3,
        isSidechain: true,
        usage: { ...BASE_USAGE, inputTokens: 400, outputTokens: 40 },
      }),
      makeTurn({
        uuid: 'side-2',
        lineNumber: 4,
        isSidechain: true,
        usage: { ...BASE_USAGE, inputTokens: 600, outputTokens: 60 },
      }),
      makeTurn({
        uuid: 'side-user',
        lineNumber: 5,
        isSidechain: true,
        role: 'user',
        usage: null,
        model: null,
      }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)
  }

  it('汇总侧链的轮数、token、成本与请求数，且主链字段一个字不变', () => {
    // Arrange
    const repo = openRepo()
    seedMixedSession(repo)

    // Act
    const overview = repo.getOverview()

    // Assert —— 主链仍是"只算主链"的旧口径：2 轮、200 输入 token
    expect(overview.turnCount).toBe(2)
    expect(overview.usage.inputTokens).toBe(200)
    expect(overview.usage.outputTokens).toBe(20)
    expect(overview.byModel).toHaveLength(1)
    expect(overview.byModel[0]?.requestCount).toBe(2)
    // opus-5-5 标准输入价 $4/M
    expect(overview.cost.inputCost).toBeCloseTo((200 * 4) / 1e6, 12)

    // Assert —— 侧链单独成一份：3 轮（含 user 消息）、2 次计费请求、1000 输入 token
    expect(overview.sidechain.turnCount).toBe(3)
    expect(overview.sidechain.requestCount).toBe(2)
    expect(overview.sidechain.usage.inputTokens).toBe(1000)
    expect(overview.sidechain.usage.outputTokens).toBe(100)
    expect(overview.sidechain.cost.inputCost).toBeCloseTo((1000 * 4) / 1e6, 12)
    expect(overview.sidechain.cost.outputCost).toBeCloseTo((100 * 20) / 1e6, 12)
    expect(overview.sidechain.cost.totalCost).toBeCloseTo((4000 + 2000) / 1e6, 12)
    // 会话详情照旧含侧链 turn：详情与统计各看各的，都不受影响
    expect(repo.getSession('sess-1')?.turns).toHaveLength(5)
  })

  it('只有侧链时主链归零，侧链照常汇总', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({
        uuid: 'only-side',
        isSidechain: true,
        usage: { ...BASE_USAGE, inputTokens: 700 },
      }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.turnCount).toBe(0)
    expect(overview.usage.inputTokens).toBe(0)
    expect(overview.byModel).toEqual([])
    expect(overview.sidechain.turnCount).toBe(1)
    expect(overview.sidechain.requestCount).toBe(1)
    expect(overview.sidechain.usage.inputTokens).toBe(700)
    expect(overview.sidechain.cost.totalCost).toBeGreaterThan(0)
  })

  it('只有主链时侧链汇总全零', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [makeTurn({ uuid: 'only-main' })]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.turnCount).toBe(1)
    expect(overview.sidechain.turnCount).toBe(0)
    expect(overview.sidechain.requestCount).toBe(0)
    expect(overview.sidechain.usage.inputTokens).toBe(0)
    expect(overview.sidechain.cost.totalCost).toBe(0)
  })

  it('两侧都没有时侧链汇总全零', () => {
    // Arrange
    const repo = openRepo()

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.sidechain.turnCount).toBe(0)
    expect(overview.sidechain.requestCount).toBe(0)
    expect(overview.sidechain.usage).toEqual({
      speed: 'standard',
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
    expect(overview.sidechain.cost.totalCost).toBe(0)
  })

  it('侧链的 user 消息计入轮数但不计入请求数与用量', () => {
    // Arrange：user 消息没有 usage 也没有 model，本来就不计费
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'side-user', isSidechain: true, role: 'user', usage: null, model: null }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.sidechain.turnCount).toBe(1)
    expect(overview.sidechain.requestCount).toBe(0)
    expect(overview.sidechain.usage.inputTokens).toBe(0)
    expect(overview.sidechain.usage.outputTokens).toBe(0)
    expect(overview.sidechain.cost.totalCost).toBe(0)
  })

  it('按模型与档位分别计价，fast 档的侧链用量不按标准价算', () => {
    // Arrange：同一模型两个档位混在侧链里，分组键丢了 speed 就会低估一半
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({
        uuid: 'side-fast',
        isSidechain: true,
        usage: { ...BASE_USAGE, speed: 'fast', inputTokens: 1_000_000, outputTokens: 0 },
      }),
      makeTurn({
        uuid: 'side-slow',
        lineNumber: 2,
        isSidechain: true,
        usage: { ...BASE_USAGE, inputTokens: 1_000_000, outputTokens: 0 },
      }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)

    // Act
    const overview = repo.getOverview()

    // Assert：$4（标准）+ $8（fast）
    expect(overview.sidechain.cost.inputCost).toBeCloseTo(4 + 8, 10)
    expect(overview.sidechain.usage.inputTokens).toBe(2_000_000)
    expect(overview.sidechain.requestCount).toBe(2)
  })

  it('数字与直接查 turns 表的原始 SQL 一致', () => {
    // Arrange：仓储自己有一套折叠逻辑，这里拿"最笨的 SQL"当独立真源。
    // 生产上也正是用这条 SQL 抽查：sqlite3 <db> "SELECT COUNT(*), SUM(output_tokens)
    // FROM turns WHERE is_sidechain = 1"
    const { repo, db } = openRepoWithDb()
    seedMixedSession(repo)
    const raw = db
      .prepare<
        [],
        {
          turn_count: number
          request_count: number
          input_tokens: number
          output_tokens: number
        }
      >(
        `SELECT COUNT(*) AS turn_count,
                SUM(CASE WHEN model IS NOT NULL THEN 1 ELSE 0 END) AS request_count,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens
         FROM turns WHERE is_sidechain = 1`,
      )
      .get()
    // 聚合查询必然返回一行；没有行说明库被改坏了，早失败比拿到 undefined 再莫名断言失败好
    if (raw === undefined) {
      throw new Error('侧链抽查 SQL 没有返回任何行')
    }

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.sidechain.turnCount).toBe(raw.turn_count)
    expect(overview.sidechain.requestCount).toBe(raw.request_count)
    expect(overview.sidechain.usage.inputTokens).toBe(raw.input_tokens)
    expect(overview.sidechain.usage.outputTokens).toBe(raw.output_tokens)
  })
})

/** 在默认用量基础上放大 token 数；其余字段（speed 等）保持不变 */
function bigUsage(inputTokens: number, outputTokens: number): TokenUsage {
  return { ...BASE_USAGE, inputTokens, outputTokens }
}

describe('会话级成本必须与 usage/turnCount 同口径', () => {
  /**
   * 曾经的缺陷：SQL_SELECT_SESSION_MODEL_USAGE / SQL_SELECT_ONE_SESSION_MODEL_USAGE
   * 只过滤了 model IS NOT NULL，没挂 SQL_MAIN_CHAIN_TURNS。于是一场主链 100 token
   * + 侧链 100 万 token 的会话会显示「1 轮 / 100 token / $6.00」——
   * cost 与 turnCount/usage 三个字段口径互相矛盾，且与总览的主链成本、
   * overview.sidechain 三方对不上。
   */
  it('列表与详情的成本不含侧链，侧链只在 overview.sidechain', () => {
    // Arrange
    const { repo } = openRepoWithDb()
    repo.upsertSession(
      makeSession({
        sessionId: 'sess-mixed-cost',
        turns: [
          makeTurn({ uuid: 'main-1', usage: bigUsage(100, 10) }),
          makeTurn({ uuid: 'side-1', isSidechain: true, usage: bigUsage(1_000_000, 100_000) }),
        ],
      }),
      makeStamp('/tmp/sess-mixed-cost.jsonl'),
    )
    repo.mergeSessionTurns(
      'sess-mixed-cost',
      [
        makeTurn({ uuid: 'main-1', usage: bigUsage(100, 10) }),
        makeTurn({ uuid: 'side-1', isSidechain: true, usage: bigUsage(1_000_000, 100_000) }),
      ],
      { startedAt: null, endedAt: null },
    )

    // Act
    const item = repo.listSessions({}).items[0]
    const detail = repo.getSession('sess-mixed-cost')
    const overview = repo.getOverview()

    // Assert：三个会话级数字同为主链口径
    if (item === undefined || detail === null) {
      throw new Error('应当能查到该会话')
    }
    expect(item.turnCount).toBe(1)
    expect(item.usage.inputTokens).toBe(100)
    expect(item.cost.totalCost).toBeCloseTo(0.0006, 6)

    // SessionDetail 没有 turnCount 字段（那是 sessions 行的列），
    // 用 turns 数组长度代替——落库的 turn 数
    expect(detail.turns).toHaveLength(2)
    expect(detail.usage.inputTokens).toBe(100)
    expect(detail.cost.totalCost).toBeCloseTo(0.0006, 6)

    // 侧链成本单独暴露，且与主链相加等于全量
    expect(overview.cost.totalCost).toBeCloseTo(0.0006, 6)
    expect(overview.sidechain.cost.totalCost).toBeCloseTo(6, 4)
  })

  it('全是侧链的会话，会话级成本为 0 而 sidechain 有值', () => {
    // Arrange
    const { repo, db } = openRepoWithDb()
    const sideTurn = makeTurn({
      uuid: 'only-side',
      isSidechain: true,
      usage: bigUsage(1_000_000, 100_000),
    })
    repo.upsertSession(
      makeSession({ sessionId: 'sess-only-side', turns: [sideTurn] }),
      makeStamp('/tmp/sess-only-side.jsonl'),
    )
    repo.mergeSessionTurns('sess-only-side', [sideTurn], { startedAt: null, endedAt: null })

    // Act
    const item = repo.listSessions({}).items[0]
    const overview = repo.getOverview()

    // Assert：会话级看不到侧链花费，但侧链汇总看得到
    if (item === undefined) {
      throw new Error('应当能查到该会话')
    }
    expect(item.cost.totalCost).toBe(0)
    expect(overview.sidechain.cost.totalCost).toBeCloseTo(6, 4)
    expect(overview.sidechain.turnCount).toBe(1)

    db.close()
  })
})
