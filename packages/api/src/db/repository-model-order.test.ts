import { describe, expect, it } from 'vitest'
import type { Session, Turn } from '@turnflare/core'
import type { SessionRepository } from './repository.js'
import { makeStamp, openRepoWithDb } from '../test-support/repository-fixtures.js'

/**
 * overview.byModel 必须按**折叠后**的总成本降序。
 *
 * 曾经的缺陷：`readOverview` 的 byModel 直接用了 foldModelStats 的结果，
 * 而 SQL 的 ORDER BY 作用在 (model, speed) 拆分行上。于是一个模型同时用了
 * standard 与 fast 两个档位时，它被拆成两行，折叠后的总额表达不了排名——
 * 实测 overview.byModel 会把 $24 的模型排到 $22 的后面，
 * 而同一个库上 getModelStats() 返回的顺序是对的，两条接口自相矛盾。
 */

/** 造一条带指定模型与档位的 assistant turn */
function turn(uuid: string, model: string, speed: 'standard' | 'fast', inputTokens: number): Turn {
  return {
    uuid,
    parentUuid: null,
    role: 'assistant',
    timestamp: '2026-10-19T08:00:00.000Z',
    model,
    usage: {
      speed,
      inputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    },
    tools: [],
    textPreview: '',
    isSidechain: false,
    lineNumber: 1,
  }
}

/** 把一场会话写进仓储：upsert 写 meta，mergeSessionTurns 写 turns */
function seed(repo: SessionRepository, session: Session): void {
  repo.upsertSession(session, makeStamp(session.meta.filePath))
  repo.mergeSessionTurns(session.meta.sessionId, session.turns, {
    startedAt: session.meta.startedAt,
    endedAt: session.meta.endedAt,
  })
}

/** 造一场只有指定 turns 的会话 */
function makeSession(sessionId: string, turns: readonly Turn[]): Session {
  return {
    meta: {
      sessionId,
      filePath: `/tmp/${sessionId}.jsonl`,
      projectSlug: 'order',
      cwd: null,
      gitBranch: null,
      cliVersion: null,
      startedAt: '2026-10-19T08:00:00.000Z',
      endedAt: '2026-10-19T08:00:00.000Z',
      models: [],
    },
    turns,
    records: [],
    parseErrors: [],
  }
}

describe('overview.byModel 的排序', () => {
  it('按折叠后的总成本降序，混合档位的模型不被拆低', () => {
    // Arrange：opus 混用两个档位，折叠后 $24；sonnet 单档 $22
    const { repo, db } = openRepoWithDb()
    seed(
      repo,
      makeSession('sess-mixed', [
        turn('t-opus-std', 'claude-opus-5-5', 'standard', 2_000_000),
        turn('t-opus-fast', 'claude-opus-5-5', 'fast', 2_000_000),
        turn('t-sonnet', 'claude-sonnet-5-5', 'standard', 11_000_000),
      ]),
    )

    // Act
    const overview = repo.getOverview()
    const modelStats = repo.getModelStats()

    // Assert：折叠后 opus $24 > sonnet $22，opus 必须排第一
    const overviewOrder = overview.byModel.map((entry) => entry.model)
    const statsOrder = modelStats.map((entry) => entry.model)
    expect(overviewOrder).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    // 两条接口的顺序必须一致，否则用户在不同页面看到不同的排名
    expect(overviewOrder).toEqual(statsOrder)

    // 折叠后的总额与请求数：opus 两档相加
    const opus = overview.byModel.find((entry) => entry.model === 'claude-opus-5-5')
    expect(opus?.cost.totalCost).toBeCloseTo(24, 6)
    expect(opus?.requestCount).toBe(2)

    db.close()
  })

  it('同成本时按模型名升序，且两次调用结果一致', () => {
    // Arrange：两个模型同样花 $4（haiku 4M × $1，opus 1M × $4）
    const { repo, db } = openRepoWithDb()
    seed(
      repo,
      makeSession('sess-tie', [
        turn('t-opus', 'claude-opus-5-5', 'standard', 1_000_000),
        turn('t-haiku', 'claude-haiku-4-5', 'standard', 4_000_000),
      ]),
    )

    // Act
    const order = repo.getOverview().byModel.map((entry) => entry.model)

    // Assert：成本相同时按名称字典序；重复调用不漂移
    expect(order).toEqual([...order].toSorted((left, right) => left.localeCompare(right)))
    expect(repo.getOverview().byModel.map((entry) => entry.model)).toEqual(order)

    db.close()
  })
})

describe('会话详情的 turn 选取：主链优先', () => {
  /**
   * 曾经的缺陷：详情按 line_number 取前 500 条。侧链 turn 数实测能到主链的
   * 11.7 倍，于是前 500 行可能全是 subagent——用户打开详情看不到自己的对话，
   * 而"Token 总量"显示的又是主链汇总，两边对不上。
   */
  it('上限之内先填主链，侧链不挤占名额', () => {
    // Arrange：主链 3 条 + 侧链 600 条，上限 500
    const { repo, db } = openRepoWithDb()
    const mainTurns = Array.from({ length: 3 }, (_, index) =>
      turn(`main-${index}`, 'claude-opus-5-5', 'standard', 1000),
    )
    const sideTurns = Array.from({ length: 600 }, (_, index) => {
      const t = turn(`side-${index}`, 'claude-opus-5-5', 'standard', 1000)
      return { ...t, isSidechain: true, lineNumber: 100 + index }
    })
    seed(
      repo,
      makeSession('sess-flood', [
        ...mainTurns.map((t, i) => ({ ...t, lineNumber: i + 1 })),
        ...sideTurns,
      ]),
    )

    // Act
    const detail = repo.getSession('sess-flood')

    // Assert：3 条主链全部在里面，且侧链只填补剩余名额
    if (detail === null) {
      throw new Error('应当能查到会话')
    }
    const mainInDetail = detail.turns.filter((t) => !t.isSidechain)
    expect(mainInDetail.map((t) => t.uuid)).toEqual(['main-0', 'main-1', 'main-2'])
    expect(detail.turns).toHaveLength(500)
    expect(detail.turns.filter((t) => t.isSidechain)).toHaveLength(497)

    db.close()
  })

  it('同一链条内保持行号升序', () => {
    // Arrange
    const { repo, db } = openRepoWithDb()
    const turns = [
      { ...turn('m-2', 'claude-opus-5-5', 'standard', 1), lineNumber: 2 },
      { ...turn('m-1', 'claude-opus-5-5', 'standard', 1), lineNumber: 1 },
      { ...turn('s-2', 'claude-opus-5-5', 'standard', 1), lineNumber: 12, isSidechain: true },
      { ...turn('s-1', 'claude-opus-5-5', 'standard', 1), lineNumber: 11, isSidechain: true },
    ]
    seed(repo, makeSession('sess-order', turns))

    // Act
    const detail = repo.getSession('sess-order')

    // Assert：主链在前（按行号），侧链在后（按行号）
    expect(detail?.turns.map((t) => t.uuid)).toEqual(['m-1', 'm-2', 's-1', 's-2'])

    db.close()
  })
})
