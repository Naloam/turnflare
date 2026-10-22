import { afterAll, describe, expect, it } from 'vitest'
import { costOf } from '@turnflare/core'
import { makeTestApp } from '../test-support/test-app.js'
import {
  BASE_USAGE,
  WRITE_TOOL,
  closeOpenedDatabases,
  makeSession,
  makeStamp,
  makeTurn,
  openRepo,
} from '../test-support/repository-fixtures.js'

afterAll(closeOpenedDatabases)

function seeded() {
  const repo = openRepo()
  const turns = [
    makeTurn({ uuid: 'user', role: 'user', model: null, usage: null }),
    makeTurn({ uuid: 'main', tools: [WRITE_TOOL] }),
    makeTurn({
      uuid: 'fast',
      timestamp: '2026-10-20T00:00:00.000Z',
      usage: { ...BASE_USAGE, speed: 'fast' },
    }),
    makeTurn({
      uuid: 'side',
      isSidechain: true,
      tools: [{ ...WRITE_TOOL, toolUseId: 'side-tool', isError: true }],
    }),
  ]
  const session = makeSession({ turns })
  repo.upsertSession(session, makeStamp(session.meta.filePath))
  repo.mergeSessionTurns(session.meta.sessionId, turns)
  const other = makeSession({
    sessionId: 'other',
    projectSlug: 'other',
    turns: [makeTurn({ uuid: 'other-turn', model: 'unknown-model' })],
  })
  repo.upsertSession(other, makeStamp('/tmp/other'))
  repo.mergeSessionTurns('other', other.turns)
  return repo
}

describe('filtered analytics', () => {
  it('keeps model, project, daily totals and tools on one cohort, including fast pricing', () => {
    const data = seeded().getAnalytics({ chain: 'all', project: '-Users-che1sy-Projects-foo' })
    const standard = costOf({ model: 'claude-opus-5-5', usage: BASE_USAGE }).totalCost
    const fast = costOf({
      model: 'claude-opus-5-5',
      usage: { ...BASE_USAGE, speed: 'fast' },
    }).totalCost
    expect(data.turnCount).toBe(4)
    expect(data.requestCount).toBe(3)
    expect(data.sessionCount).toBe(1)
    expect(data.cost.totalCost).toBeCloseTo(standard * 2 + fast)
    expect(data.models[0]?.cost.totalCost).toBeCloseTo(data.cost.totalCost)
    expect(data.projects[0]?.cost.totalCost).toBeCloseTo(data.cost.totalCost)
    expect(data.days.reduce((sum, day) => sum + day.cost.totalCost, 0)).toBeCloseTo(
      data.cost.totalCost,
    )
    expect(data.tools[0]).toMatchObject({ callCount: 2, errorCount: 1 })
    expect(data.cost.unpricedModel).toBe(false)
  })

  it('uses inclusive since and exclusive until, intersects filters, and never counts excluded side tools', () => {
    const repo = seeded()
    const data = repo.getAnalytics({
      chain: 'main',
      model: 'claude-opus-5-5',
      since: '2026-10-19T00:00:00.000Z',
      until: '2026-10-20T00:00:00.000Z',
    })
    expect(data.requestCount).toBe(1)
    expect(data.turnCount).toBe(1)
    expect(data.tools[0]).toMatchObject({ callCount: 1, errorCount: 0 })
    expect(repo.getAnalytics({ chain: 'side' }).requestCount).toBe(1)
    expect(repo.getAnalytics({ project: "' OR 1=1 --" }).sessionCount).toBe(0)
    expect(repo.getAnalytics({ model: 'unknown-model' }).cost.unpricedModel).toBe(true)
    expect(repo.getAnalytics({ project: 'missing' }).days).toEqual([])
  })

  it('validates filters and exports exactly the displayed cohort in every report format', async () => {
    const app = await makeTestApp({ repo: seeded() })
    try {
      for (const query of ['chain=bad', 'since=oops', 'since=2026-10-22&until=2026-10-20']) {
        expect((await app.inject(`/api/stats/analytics?${query}`)).statusCode).toBe(400)
      }
      const options = (await app.inject('/api/stats/analytics/options')).json().data
      expect(options.projects).toContain('other')
      expect(options.models).toContain('unknown-model')
      const response = await app.inject('/api/stats/analytics?chain=side&since=2026-10-19')
      expect(response.statusCode).toBe(200)
      expect(response.json().data.requestCount).toBe(1)
      const json = await app.inject('/api/report?format=json&chain=side&since=2026-10-19')
      expect(json.json().data.overview.cost.totalCost).toBeCloseTo(
        response.json().data.cost.totalCost,
      )
      expect(json.json().data.filters.chain).toBe('side')
      for (const format of ['markdown', 'html', 'csv']) {
        const report = await app.inject(`/api/report?format=${format}&chain=side&project=other`)
        expect(report.statusCode).toBe(200)
        expect(report.body).toContain('side')
        expect(report.body).toContain('other')
      }
      expect((await app.inject('/api/report?format=json&chain=oops')).statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('session preview search', () => {
  it('searches previews and metadata literally, with matching pagination counts', () => {
    const repo = seeded()
    expect(repo.listSessions({ search: '预览文本', limit: 1 }).total).toBe(2)
    expect(repo.listSessions({ search: '预览文本', page: 2, limit: 1 }).items).toHaveLength(1)
    expect(repo.listSessions({ search: 'OTHER' }).total).toBe(1)
    expect(repo.listSessions({ search: '%' }).total).toBe(0)
    expect(repo.listSessions({ search: "' OR 1=1 --" }).total).toBe(0)
    expect(repo.listSessions({ search: 'main', project: 'missing' }).total).toBe(0)
  })
})
