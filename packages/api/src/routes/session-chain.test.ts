import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../server.js'
import { loadConfig } from '../config.js'
import {
  makeSession,
  makeStamp,
  makeTurn,
  openRepo,
  closeOpenedDatabases,
} from '../test-support/repository-fixtures.js'

describe('session chain filtering before the detail limit', () => {
  let app: FastifyInstance | undefined
  afterEach(async () => {
    await app?.close()
    closeOpenedDatabases()
  })

  it('returns subagents even after more than 500 main-chain turns', async () => {
    const repo = openRepo()
    const main = Array.from({ length: 501 }, (_, index) =>
      makeTurn({ uuid: `main-${index}`, lineNumber: index + 1 }),
    )
    const side = makeTurn({ uuid: 'side-agent', isSidechain: true, lineNumber: 900 })
    const session = makeSession({ turns: [...main, side] })
    repo.upsertSession(session, makeStamp('/tmp/chain.jsonl'))
    repo.mergeSessionTurns(session.meta.sessionId, session.turns)
    app = buildApp({ repo, config: loadConfig({ LOG_LEVEL: 'error' }) })

    const all = await app.inject(`/api/sessions/${session.meta.sessionId}`)
    expect(all.json().data.turns).toHaveLength(500)
    const filtered = await app.inject(`/api/sessions/${session.meta.sessionId}?chain=side`)
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().data.turns.map((turn: { uuid: string }) => turn.uuid)).toEqual([
      'side-agent',
    ])
    expect(filtered.json().data.chainCounts).toEqual({ total: 502, main: 501, side: 1 })
    const mainOnly = await app.inject(`/api/sessions/${session.meta.sessionId}?chain=main`)
    expect(mainOnly.json().data.turns).toHaveLength(500)
    const second = await app.inject(`/api/sessions/${session.meta.sessionId}?chain=main&page=2`)
    expect(second.json().data.turns).toHaveLength(1)
    expect(second.json().data.turns[0].uuid).toBe('main-500')
    expect(second.json().data.chainCounts.main).toBe(501)
    expect((await app.inject(`/api/sessions/${session.meta.sessionId}?page=0`)).statusCode).toBe(
      400,
    )

    expect(
      mainOnly.json().data.turns.every((turn: { isSidechain: boolean }) => !turn.isSidechain),
    ).toBe(true)
  })

  it('rejects invalid chain values before querying storage', async () => {
    app = buildApp({ repo: openRepo(), config: loadConfig({ LOG_LEVEL: 'error' }) })
    const response = await app.inject('/api/sessions/unknown?chain=invalid')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('chain')
  })
})
