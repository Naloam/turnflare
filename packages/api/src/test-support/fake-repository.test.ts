import type { Session } from '@turnflare/core'
import { describe, expect, it } from 'vitest'
import type { FileStamp } from '../db/repository.js'
import { makeSessionDetail, makeSessionSeries, makeTurns } from './fixtures.js'
import { FakeRepository } from './fake-repository.js'

const STAMP: FileStamp = { filePath: '/tmp/a.jsonl', mtimeMs: 100, sizeBytes: 200 }

function makeScanSession(sessionId: string): Session {
  return {
    meta: {
      sessionId,
      filePath: `/tmp/${sessionId}.jsonl`,
      projectSlug: '-Users-che1sy-Projects-zeta',
      cwd: null,
      gitBranch: null,
      cliVersion: null,
      startedAt: null,
      endedAt: null,
      models: ['claude-opus-5-5'],
    },
    turns: makeTurns(3),
    records: [],
    parseErrors: [],
  }
}

describe('FakeRepository', () => {
  it('upsert + replace 后列表与详情一致', () => {
    // Arrange
    const repo = new FakeRepository()

    // Act
    repo.upsertSession(makeScanSession('sess-1'), STAMP)
    repo.mergeSessionTurns('sess-1', makeTurns(2))

    // Assert
    expect(repo.countSessions()).toBe(1)
    expect(repo.getSession('sess-1')?.turns).toHaveLength(2)
    const { items, total } = repo.listSessions({
      page: 1,
      limit: 50,
      sort: 'cost',
      order: 'desc',
    })
    expect(total).toBe(1)
    expect(items[0]?.turnCount).toBe(2)
  })

  it('replace 未知会话时静默忽略', () => {
    const repo = new FakeRepository()

    repo.mergeSessionTurns('nope', makeTurns(2))

    expect(repo.countSessions()).toBe(0)
  })

  it('记录文件指纹，供增量扫描判断', () => {
    const repo = new FakeRepository()

    repo.upsertSession(makeScanSession('sess-1'), STAMP)

    expect(repo.getFileStamps()).toEqual([STAMP])
  })

  it('clearAll 清空会话、指纹与最近扫描时间', () => {
    const repo = new FakeRepository({
      sessions: [makeSessionDetail()],
      lastScanAt: '2026-10-19T10:08:04.883Z',
    })
    repo.upsertSession(makeScanSession('sess-2'), STAMP)

    repo.clearAll()

    expect(repo.countSessions()).toBe(0)
    expect(repo.getFileStamps()).toEqual([])
    expect(repo.getLastScanAt()).toBeNull()
  })

  it('四种排序字段都按预期方向排', () => {
    const repo = new FakeRepository({ sessions: makeSessionSeries(3) })
    const base = { page: 1, limit: 50, order: 'desc' } as const

    const byCost = repo.listSessions({ ...base, sort: 'cost' }).items.map((item) => item.sessionId)
    const byCostAsc = repo
      .listSessions({ ...base, sort: 'cost', order: 'asc' })
      .items.map((item) => item.sessionId)
    const byTurns = repo
      .listSessions({ ...base, sort: 'turns' })
      .items.map((item) => item.turnCount)

    expect(byCostAsc).toEqual([...byCost].reverse())
    expect(byTurns).toEqual([3, 2, 1])
  })

  it('同分时按 sessionId 升序，保证翻页稳定', () => {
    const sameCost = [
      makeSessionDetail({ sessionId: 'bbbb' }),
      makeSessionDetail({ sessionId: 'aaaa' }),
      makeSessionDetail({ sessionId: 'cccc' }),
    ]
    const repo = new FakeRepository({ sessions: sameCost })

    const ids = repo
      .listSessions({ page: 1, limit: 50, sort: 'cost', order: 'desc' })
      .items.map((item) => item.sessionId)

    expect(ids).toEqual(['aaaa', 'bbbb', 'cccc'])
  })

  it('分页切片与 total 分离', () => {
    const repo = new FakeRepository({ sessions: makeSessionSeries(5) })

    const { items, total } = repo.listSessions({
      page: 2,
      limit: 2,
      sort: 'cost',
      order: 'desc',
    })

    expect(items).toHaveLength(2)
    expect(total).toBe(5)
  })

  it('时间线按粒度选桶，并按 since / until 收窄', () => {
    const repo = new FakeRepository()

    const hour = repo.getTimeline({ granularity: 'hour' })
    const day = repo.getTimeline({ granularity: 'day' })
    const ranged = repo.getTimeline({ granularity: 'day', until: '2026-10-19' })

    expect(hour[0]?.bucket).toBe('2026-10-19T08:00:00Z')
    expect(day[0]?.bucket).toBe('2026-10-19')
    expect(ranged).toHaveLength(0)
  })

  it('统计口径直接来自夹具', () => {
    const repo = new FakeRepository()

    expect(repo.getOverview().sessionCount).toBe(3)
    expect(repo.getModelStats()).toHaveLength(1)
    expect(repo.getProjectStats()).toHaveLength(1)
    expect(repo.getToolStats()).toHaveLength(1)
  })
})
