import { afterAll, describe, expect, it } from 'vitest'
import type { Session, Turn } from '@turnflare/core'
import type { SessionRepository } from './repository.js'
import {
  BASE_USAGE,
  WRITE_TOOL,
  closeOpenedDatabases,
  makeSession,
  makeStamp,
  makeTurn,
  openRepo,
} from '../test-support/repository-fixtures.js'

afterAll(() => {
  closeOpenedDatabases()
})

// ─── 测试 ────────────────────────────────────────────────────────────────────

/** 列表查询的默认形态：按最近排序、一页 10 条 */
const BASE_QUERY = {
  page: 1,
  limit: 10,
  sort: 'recent',
  order: 'desc',
} as const

describe('upsertSession', () => {
  it('writes a new session row', () => {
    // Arrange
    const repo = openRepo()
    const session = makeSession({ turns: [makeTurn({ tools: [WRITE_TOOL] })] })

    // Act
    repo.upsertSession(session, makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', session.turns)

    // Assert
    expect(repo.countSessions()).toBe(1)
    const detail = repo.getSession('sess-1')
    expect(detail?.turns).toHaveLength(1)
    expect(detail?.usage.inputTokens).toBe(100)
    expect(detail?.models).toEqual(['claude-opus-5-5'])
    expect(detail?.turns[0]?.tools).toEqual([WRITE_TOOL])
  })

  it('updates instead of failing when the same sessionId is written twice', () => {
    // Arrange
    const repo = openRepo()
    const first = makeSession({ turns: [makeTurn()] })
    const second = makeSession({
      turns: [makeTurn({ uuid: 'turn-9' }), makeTurn({ uuid: 'turn-10', lineNumber: 2 })],
    })

    // Act
    repo.upsertSession(first, makeStamp('/tmp/sess-1.jsonl', 1000, 2048))
    repo.upsertSession(second, makeStamp('/tmp/sess-1.jsonl', 2000, 4096))

    // Assert
    expect(repo.countSessions()).toBe(1)
    expect(repo.listSessions(BASE_QUERY).items[0]?.turnCount).toBe(2)
    expect(repo.getFileStamps()).toEqual([makeStamp('/tmp/sess-1.jsonl', 2000, 4096)])
  })
})

describe('mergeSessionTurns', () => {
  it('merges turns from a second file sharing the same sessionId', () => {
    // Arrange：Claude Code 的 subagent 记录复用父会话的 sessionId，
    // 所以同一个会话会对应多个文件，后扫的文件必须累加而不是覆盖。
    const repo = openRepo()
    repo.upsertSession(makeSession(), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', [
      makeTurn({ uuid: 'turn-a', tools: [WRITE_TOOL] }),
      makeTurn({ uuid: 'turn-b', lineNumber: 2, role: 'user', usage: null, model: null }),
    ])

    // Act：第二个文件只带它自己那一条 turn
    repo.mergeSessionTurns('sess-1', [makeTurn({ uuid: 'turn-c', lineNumber: 3 })])

    // Assert：三条都在，先前的工具调用也没有被冲掉
    const detail = repo.getSession('sess-1')
    expect(detail?.turns.map((turn) => turn.uuid)).toEqual(['turn-a', 'turn-b', 'turn-c'])
    expect(detail?.turns[0]?.tools).toEqual([WRITE_TOOL])
    expect(repo.getToolStats()[0]?.callCount).toBe(1)
  })

  it('keeps tool invocations of turns that were already stored', () => {
    // Arrange
    const repo = openRepo()
    repo.upsertSession(makeSession(), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', [
      makeTurn({ uuid: 'turn-a', tools: [WRITE_TOOL] }),
      makeTurn({ uuid: 'turn-b', lineNumber: 2, role: 'user', usage: null, model: null }),
    ])

    // Act：重复合并同一批（compaction 会让同一条消息在文件里出现多次）
    repo.mergeSessionTurns('sess-1', [
      makeTurn({ uuid: 'turn-a', tools: [WRITE_TOOL] }),
      makeTurn({ uuid: 'turn-c', lineNumber: 3 }),
    ])

    // Assert：turn 不重复，工具调用也不翻倍
    const detail = repo.getSession('sess-1')
    expect(detail?.turns.map((turn) => turn.uuid)).toEqual(['turn-a', 'turn-b', 'turn-c'])
    expect(repo.getToolStats()[0]?.callCount).toBe(1)
  })

  it('records tool statistics for the turns that are kept', () => {
    // Arrange
    const repo = openRepo()
    repo.upsertSession(makeSession(), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', [
      makeTurn({ uuid: 'turn-a', tools: [WRITE_TOOL] }),
      makeTurn({
        uuid: 'turn-b',
        lineNumber: 2,
        tools: [{ ...WRITE_TOOL, toolUseId: 'tool-2', isError: true, resultBytes: 64 }],
      }),
    ])

    // Assert
    expect(repo.getToolStats()).toEqual([
      { toolName: 'Write', callCount: 2, errorCount: 1, totalResultBytes: 192 },
    ])
  })

  it('dedupes turns by uuid because compaction repeats the same message', () => {
    // Arrange
    const repo = openRepo()
    repo.upsertSession(makeSession(), makeStamp('/tmp/sess-1.jsonl'))

    // Act：同一条消息在 jsonl 里出现两次，保留首次
    repo.mergeSessionTurns('sess-1', [
      makeTurn({ uuid: 'dup', lineNumber: 1 }),
      makeTurn({ uuid: 'dup', lineNumber: 5 }),
    ])

    // Assert
    const detail = repo.getSession('sess-1')
    expect(detail?.turns).toHaveLength(1)
    expect(detail?.turns[0]?.lineNumber).toBe(1)
    expect(repo.listSessions(BASE_QUERY).items[0]?.turnCount).toBe(1)
  })

  it('drops synthetic model records so the model distribution stays honest', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'real', lineNumber: 1 }),
      makeTurn({ uuid: 'fake', lineNumber: 2, model: '<synthetic>' }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)

    // Assert
    expect(repo.getModelStats().map((stats) => stats.model)).toEqual(['claude-opus-5-5'])
    expect(repo.getSession('sess-1')?.models).toEqual(['claude-opus-5-5'])
  })

  it('rolls the whole merge back when a row violates a constraint', () => {
    // Arrange：role 有 CHECK 约束，只允许 user/assistant。
    // 旧实现靠"uuid 撞主键抛错"来验证回滚，但合并语义改用
    // `ON CONFLICT (uuid) DO NOTHING` 之后跨会话的 uuid 冲突会被静默去重
    // （那正是我们想要的），所以改用一个真正会失败的约束来验证事务原子性。
    const repo = openRepo()
    repo.upsertSession(makeSession({ sessionId: 'sess-1' }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', [makeTurn({ uuid: 'shared' })])
    repo.upsertSession(makeSession({ sessionId: 'sess-2' }), makeStamp('/tmp/sess-2.jsonl'))

    // Act
    expect(() =>
      repo.mergeSessionTurns('sess-2', [
        makeTurn({ uuid: 'fresh', lineNumber: 1 }),
        makeTurn({ uuid: 'bad-role', lineNumber: 2, role: 'system' as 'user' }),
      ]),
    ).toThrow()

    // Assert：先插成功的那行也必须消失，不能留下半套 turn
    expect(repo.getSession('sess-2')?.turns).toEqual([])
  })

  it('ignores a turn uuid already owned by another session', () => {
    // Arrange：同一 turn 出现在两场会话的文件里时，先入库的一方留下
    const repo = openRepo()
    repo.upsertSession(makeSession({ sessionId: 'sess-1' }), makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', [makeTurn({ uuid: 'shared' })])
    repo.upsertSession(makeSession({ sessionId: 'sess-2' }), makeStamp('/tmp/sess-2.jsonl'))

    // Act：不抛错，静默去重
    repo.mergeSessionTurns('sess-2', [
      makeTurn({ uuid: 'own', lineNumber: 1 }),
      makeTurn({ uuid: 'shared', lineNumber: 2 }),
    ])

    // Assert
    expect(repo.getSession('sess-2')?.turns.map((turn) => turn.uuid)).toEqual(['own'])
    expect(repo.getSession('sess-1')?.turns.map((turn) => turn.uuid)).toEqual(['shared'])
  })
})

describe('getSession', () => {
  it('returns null for an unknown session id', () => {
    // Arrange
    const repo = openRepo()

    // Act / Assert
    expect(repo.getSession('does-not-exist')).toBeNull()
  })

  it('returns the parse error count recorded at scan time', () => {
    // Arrange
    const repo = openRepo()
    const session = makeSession({
      parseErrors: [{ lineNumber: 7, message: '坏行', rawExcerpt: '{"trunc' }],
    })
    repo.upsertSession(session, makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', session.turns)

    // Act
    const detail = repo.getSession('sess-1')

    // Assert
    expect(detail?.parseErrorCount).toBe(1)
  })

  it('orders turns by line number and reattaches their tools', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'b', lineNumber: 2, tools: [{ ...WRITE_TOOL, toolUseId: 'tool-9' }] }),
      makeTurn({ uuid: 'a', lineNumber: 1 }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const detail = repo.getSession('sess-1')

    // Assert
    expect(detail?.turns.map((turn) => turn.uuid)).toEqual(['a', 'b'])
    expect(detail?.turns[1]?.tools).toEqual([{ ...WRITE_TOOL, toolUseId: 'tool-9' }])
  })

  it('reads the billing tier of each turn back from the turns table', () => {
    // Arrange：详情走 SELECT *，新加的 speed 列必须被原样带回来，
    // 否则前端看到的每条 turn 都退化成标准档
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'slow', lineNumber: 1 }),
      makeTurn({ uuid: 'quick', lineNumber: 2, usage: { ...BASE_USAGE, speed: 'fast' } }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const detail = repo.getSession('sess-1')

    // Assert
    expect(detail?.turns.map((turn) => turn.usage?.speed)).toEqual(['standard', 'fast'])
  })

  it('caps the returned turns at 500 while the count stays truthful', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = Array.from({ length: 620 }, (_unused, index) =>
      makeTurn({ uuid: `turn-${String(index)}`, lineNumber: index + 1 }),
    )
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const detail = repo.getSession('sess-1')

    // Assert
    expect(detail?.turns).toHaveLength(500)
    // 详情只带回 500 条，真实轮次总数走列表项读
    expect(repo.listSessions(BASE_QUERY).items[0]?.turnCount).toBe(620)
  })

  it('recomputes the cost breakdown per model for a mixed-model session', () => {
    // Arrange：schema 只存了成本总额，分项必须回到 turns 表按模型重算
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'a', lineNumber: 1, model: 'claude-opus-5-5' }),
      makeTurn({ uuid: 'b', lineNumber: 2, model: 'claude-haiku-4-5' }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const detail = repo.getSession('sess-1')

    // Assert
    // opus：100×4/1e6 + 10×20/1e6；haiku-4-5：100×1/1e6 + 10×5/1e6
    expect(detail?.cost.inputCost).toBeCloseTo((400 + 100) / 1e6, 12)
    expect(detail?.cost.outputCost).toBeCloseTo((200 + 50) / 1e6, 12)
    expect(detail?.cost.totalCost).toBeGreaterThan(0)
  })

  it('prices fast-tier turns at the fast rate when recomputing the breakdown', () => {
    // Arrange：schema 只存总额，分项要回 turns 表重算；档位一旦在分组里丢掉，
    // fast 请求就会被按标准价计——正是低估一半的那个 bug
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({
        uuid: 'fast',
        usage: { ...BASE_USAGE, speed: 'fast', inputTokens: 1_000_000, outputTokens: 0 },
      }),
      makeTurn({
        uuid: 'slow',
        lineNumber: 2,
        usage: { ...BASE_USAGE, inputTokens: 1_000_000, outputTokens: 0 },
      }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const detail = repo.getSession('sess-1')
    const listed = repo.listSessions(BASE_QUERY).items[0]

    // Assert：opus-5-5 标准输入价 $4/M、fast $8/M，两条各 100 万输入 token → $4 + $8
    expect(detail?.cost.inputCost).toBeCloseTo(4 + 8, 10)
    expect(detail?.cost.totalCost).toBeCloseTo(4 + 8, 10)
    // 详情页与列表页走的是同一条重算路径，数字必须一致
    expect(listed?.cost.totalCost).toBeCloseTo(4 + 8, 10)
  })
})

describe('listSessions', () => {
  function seedThreeSessions(repo: SessionRepository): void {
    const sessions: readonly Session[] = [
      makeSession({
        sessionId: 'sess-a',
        startedAt: '2026-10-01T08:00:00.000Z',
        turns: [makeTurn({ uuid: 'a1' }), makeTurn({ uuid: 'a2', lineNumber: 2 })],
      }),
      makeSession({
        sessionId: 'sess-b',
        startedAt: '2026-10-02T08:00:00.000Z',
        turns: [
          makeTurn({ uuid: 'b1', usage: { ...BASE_USAGE, inputTokens: 10 } }),
          makeTurn({ uuid: 'b2', lineNumber: 2, usage: { ...BASE_USAGE, inputTokens: 10 } }),
          makeTurn({ uuid: 'b3', lineNumber: 3, usage: { ...BASE_USAGE, inputTokens: 10 } }),
        ],
      }),
      makeSession({
        sessionId: 'sess-c',
        startedAt: '2026-10-03T08:00:00.000Z',
        turns: [makeTurn({ uuid: 'c1', usage: { ...BASE_USAGE, inputTokens: 1000 } })],
      }),
    ]
    for (const session of sessions) {
      repo.upsertSession(session, makeStamp(`/tmp/${session.meta.sessionId}.jsonl`))
      repo.mergeSessionTurns(session.meta.sessionId, session.turns)
    }
  }

  it('paginates and reports the unfiltered total', () => {
    // Arrange
    const repo = openRepo()
    seedThreeSessions(repo)

    // Act
    const firstPage = repo.listSessions({ ...BASE_QUERY, limit: 2 })
    const secondPage = repo.listSessions({ ...BASE_QUERY, limit: 2, page: 2 })
    const beyond = repo.listSessions({ ...BASE_QUERY, page: 9 })

    // Assert
    expect(firstPage.total).toBe(3)
    expect(firstPage.items).toHaveLength(2)
    expect(secondPage.items).toHaveLength(1)
    expect(beyond.items).toHaveLength(0)
  })

  it('maps every sort whitelist entry to the expected order', () => {
    // Arrange
    const repo = openRepo()
    seedThreeSessions(repo)
    // 三场会话的四个排序键刻意不共线：sess-c 最贵、sess-b 轮次最多、sess-a 最早
    const ids = (sort: 'cost' | 'tokens' | 'recent' | 'turns', order: 'asc' | 'desc'): string[] =>
      repo.listSessions({ ...BASE_QUERY, sort, order }).items.map((item) => item.sessionId)

    // Act / Assert
    expect(ids('cost', 'desc')).toEqual(['sess-c', 'sess-a', 'sess-b'])
    expect(ids('tokens', 'desc')).toEqual(['sess-c', 'sess-a', 'sess-b'])
    expect(ids('turns', 'desc')).toEqual(['sess-b', 'sess-a', 'sess-c'])
    expect(ids('recent', 'desc')).toEqual(['sess-c', 'sess-b', 'sess-a'])
    expect(ids('cost', 'asc')).toEqual(['sess-b', 'sess-a', 'sess-c'])
    expect(ids('tokens', 'asc')).toEqual(['sess-b', 'sess-a', 'sess-c'])
    expect(ids('turns', 'asc')).toEqual(['sess-c', 'sess-a', 'sess-b'])
    expect(ids('recent', 'asc')).toEqual(['sess-a', 'sess-b', 'sess-c'])
  })

  it('refuses a sort key that is not on the whitelist', () => {
    // Arrange：排序字段绝不允许透传进 SQL，否则就是注入入口
    const repo = openRepo()
    seedThreeSessions(repo)

    // Act / Assert
    expect(() =>
      repo.listSessions({
        ...BASE_QUERY,
        sort: 'total_cost_usd; DROP TABLE sessions' as 'cost',
      }),
    ).toThrow()
    expect(() =>
      repo.listSessions({ ...BASE_QUERY, order: 'DESC; DROP TABLE sessions' as 'desc' }),
    ).toThrow()
    expect(repo.countSessions()).toBe(3)
  })

  it('filters by project and by model', () => {
    // Arrange
    const repo = openRepo()
    seedThreeSessions(repo)
    repo.upsertSession(
      makeSession({
        sessionId: 'sess-other',
        projectSlug: '-Users-che1sy-Projects-bar',
        turns: [makeTurn({ uuid: 'o1', model: 'claude-haiku-4-5' })],
      }),
      makeStamp('/tmp/sess-other.jsonl'),
    )
    repo.mergeSessionTurns('sess-other', [makeTurn({ uuid: 'o1', model: 'claude-haiku-4-5' })])

    // Act
    const byProject = repo.listSessions({ ...BASE_QUERY, project: '-Users-che1sy-Projects-foo' })
    const byModel = repo.listSessions({ ...BASE_QUERY, model: 'claude-haiku-4-5' })

    // Assert
    expect(byProject.total).toBe(3)
    expect(byModel.items.map((item) => item.sessionId)).toEqual(['sess-other'])
  })
})

describe('getOverview', () => {
  it('returns an all-zero structure for an empty database', () => {
    // Arrange
    const repo = openRepo()

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.sessionCount).toBe(0)
    expect(overview.turnCount).toBe(0)
    expect(overview.usage).toEqual({
      speed: 'standard',
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      serverToolUse: 0,
    })
    expect(overview.cost.totalCost).toBe(0)
    expect(overview.byModel).toEqual([])
    expect(overview.byProject).toEqual([])
    expect(overview.byHour).toEqual([])
    expect(overview.byDay).toEqual([])
    expect(overview.toolUsage).toEqual([])
    expect(overview.cacheHitRate).toBe(0)
    expect(overview.errorRate).toBe(0)
    expect(overview.firstActivityAt).toBeNull()
    expect(overview.lastActivityAt).toBeNull()
    expect(repo.getLastScanAt()).toBeNull()
  })

  it('aggregates usage, cache hit rate and activity range', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({
        uuid: 'a1',
        timestamp: '2026-10-19T08:00:00.000Z',
        usage: { ...BASE_USAGE, inputTokens: 100, cacheReadTokens: 900 },
      }),
      makeTurn({
        uuid: 'a2',
        lineNumber: 2,
        timestamp: '2026-10-19T09:00:00.000Z',
        usage: { ...BASE_USAGE, inputTokens: 50 },
      }),
    ]
    const session = makeSession({ turns })
    repo.upsertSession(session, makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', turns)

    // Act
    const overview = repo.getOverview()

    // Assert
    expect(overview.sessionCount).toBe(1)
    expect(overview.usage.inputTokens).toBe(150)
    expect(overview.usage.cacheReadTokens).toBe(900)
    expect(overview.cacheHitRate).toBeCloseTo(900 / (150 + 900), 5)
    expect(overview.firstActivityAt).toBe('2026-10-19T08:00:00.000Z')
    expect(overview.lastActivityAt).toBe('2026-10-19T09:00:00.000Z')
    expect(overview.cost.totalCost).toBeGreaterThan(0)
    expect(repo.getLastScanAt()).not.toBeNull()
  })
})

describe('grouped statistics', () => {
  function seedTwoProjects(repo: SessionRepository): void {
    const fooTurns: readonly Turn[] = [
      makeTurn({ uuid: 'f1', timestamp: '2026-10-19T08:15:00.000Z', usage: BASE_USAGE }),
      makeTurn({
        uuid: 'f2',
        lineNumber: 2,
        timestamp: '2026-10-19T08:45:00.000Z',
        usage: { ...BASE_USAGE, inputTokens: 10 },
      }),
      makeTurn({
        uuid: 'f3',
        lineNumber: 3,
        timestamp: '2026-10-19T09:05:00.000Z',
        usage: { ...BASE_USAGE, inputTokens: 20 },
      }),
    ]
    const barTurns: readonly Turn[] = [
      makeTurn({
        uuid: 'g1',
        timestamp: '2026-10-20T01:00:00.000Z',
        model: 'claude-haiku-4-5',
        usage: { ...BASE_USAGE, inputTokens: 30 },
      }),
    ]

    const foo = makeSession({ sessionId: 'sess-foo', turns: fooTurns })
    const bar = makeSession({
      sessionId: 'sess-bar',
      projectSlug: '-Users-che1sy-Projects-bar',
      turns: barTurns,
    })
    for (const session of [foo, bar]) {
      repo.upsertSession(session, makeStamp(`/tmp/${session.meta.sessionId}.jsonl`))
      repo.mergeSessionTurns(session.meta.sessionId, session.turns)
    }
  }

  it('buckets the timeline by hour', () => {
    // Arrange
    const repo = openRepo()
    seedTwoProjects(repo)

    // Act
    const buckets = repo.getTimeline({ granularity: 'hour' })

    // Assert
    expect(buckets.map((bucket) => bucket.bucket)).toEqual([
      '2026-10-19T08:00:00Z',
      '2026-10-19T09:00:00Z',
      '2026-10-20T01:00:00Z',
    ])
    expect(buckets.map((bucket) => bucket.requestCount)).toEqual([2, 1, 1])
    expect(buckets[0]?.usage.inputTokens).toBe(110)
  })

  it('buckets the timeline by day', () => {
    // Arrange
    const repo = openRepo()
    seedTwoProjects(repo)

    // Act
    const buckets = repo.getTimeline({ granularity: 'day' })

    // Assert
    expect(buckets.map((bucket) => bucket.bucket)).toEqual(['2026-10-19', '2026-10-20'])
    expect(buckets.map((bucket) => bucket.requestCount)).toEqual([3, 1])
  })

  it('filters the timeline by project and by time window', () => {
    // Arrange
    const repo = openRepo()
    seedTwoProjects(repo)

    // Act
    const byProject = repo.getTimeline({
      granularity: 'hour',
      project: '-Users-che1sy-Projects-bar',
    })
    const sinceOnly = repo.getTimeline({
      granularity: 'day',
      since: '2026-10-20T00:00:00.000Z',
    })
    const untilOnly = repo.getTimeline({
      granularity: 'hour',
      until: '2026-10-19T09:00:00.000Z',
    })

    // Assert
    expect(byProject.map((bucket) => bucket.bucket)).toEqual(['2026-10-20T01:00:00Z'])
    expect(sinceOnly.map((bucket) => bucket.bucket)).toEqual(['2026-10-20'])
    expect(untilOnly.map((bucket) => bucket.bucket)).toEqual(['2026-10-19T08:00:00Z'])
  })

  it('groups model and project statistics', () => {
    // Arrange
    const repo = openRepo()
    seedTwoProjects(repo)

    // Act
    const models = repo.getModelStats()
    const projects = repo.getProjectStats()

    // Assert
    expect(models.map((stats) => stats.model)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
    expect(models[0]?.requestCount).toBe(3)
    // 项目分布按成本降序，与 core 的 aggregate().byProject 保持一致；
    // 成本相同时才退回 slug 升序
    expect(projects.map((stats) => stats.projectSlug)).toEqual([
      '-Users-che1sy-Projects-foo',
      '-Users-che1sy-Projects-bar',
    ])
    expect(projects[0]?.sessionCount).toBe(1)
    expect(projects[1]?.sessionCount).toBe(1)
    expect(projects[0]?.usage.inputTokens).toBe(130)
    expect(projects[1]?.usage.inputTokens).toBe(30)
  })

  it('keeps sidechain turns out of every statistic', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'main', lineNumber: 1 }),
      makeTurn({
        uuid: 'side',
        lineNumber: 2,
        isSidechain: true,
        usage: { ...BASE_USAGE, inputTokens: 999_999 },
      }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const overview = repo.getOverview()

    // Assert
    expect(overview.usage.inputTokens).toBe(100)
    expect(overview.byHour).toHaveLength(1)
    expect(overview.turnCount).toBe(1)
    // 侧链不进主链，但也不是凭空消失：它单独汇总在 sidechain 上
    expect(overview.sidechain.turnCount).toBe(1)
    expect(overview.sidechain.usage.inputTokens).toBe(999_999)
  })

  it('keeps the session-level usage in step with the turn-level sums', () => {
    // Arrange
    const repo = openRepo()
    const turns: readonly Turn[] = [
      makeTurn({ uuid: 'a', usage: { ...BASE_USAGE, inputTokens: 500 } }),
    ]
    repo.upsertSession(makeSession({ turns }), makeStamp('/tmp/sess-1.jsonl'))

    // Act
    repo.mergeSessionTurns('sess-1', turns)
    const overview = repo.getOverview()
    const listed = repo.listSessions(BASE_QUERY)

    // Assert
    expect(overview.usage.inputTokens).toBe(500)
    expect(listed.items[0]?.usage.inputTokens).toBe(500)
  })
})

describe('clearAll', () => {
  it('removes sessions, turns and tool invocations', () => {
    // Arrange
    const repo = openRepo()
    const session = makeSession({ turns: [makeTurn({ tools: [WRITE_TOOL] })] })
    repo.upsertSession(session, makeStamp('/tmp/sess-1.jsonl'))
    repo.mergeSessionTurns('sess-1', session.turns)

    // Act
    repo.clearAll()

    // Assert
    expect(repo.countSessions()).toBe(0)
    expect(repo.getFileStamps()).toEqual([])
    expect(repo.getOverview().turnCount).toBe(0)
    expect(repo.getOverview().toolUsage).toEqual([])
  })
})
