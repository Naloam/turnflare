import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRepository } from '../test-support/fake-repository.js'
import { makeSessionDetail } from '../test-support/fixtures.js'
import {
  makeTestApp,
  parseData,
  readEnvelope,
  sessionListItemSchema,
  z,
} from '../test-support/test-app.js'

const LAST_SCAN_AT = '2026-10-19T10:08:04.883Z'

describe('GET /api/health', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    const repo = new FakeRepository({
      sessions: [
        makeSessionDetail(),
        makeSessionDetail({ sessionId: 'bbbbbbbb-2222-4333-8444-555555555555' }),
      ],
      lastScanAt: LAST_SCAN_AT,
    })
    app = await makeTestApp({ repo })
  })

  afterEach(async () => {
    await app.close()
  })

  it('返回版本、数据根目录与最近扫描时间', async () => {
    // Arrange / Act
    const response = await app.inject({ method: 'GET', url: '/api/health' })

    // Assert
    expect(response.statusCode).toBe(200)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(true)
    expect(envelope.error).toBeNull()
    const data = parseData(
      envelope.data,
      z.object({
        name: z.string(),
        version: z.string(),
        dataRoot: z.string(),
        sessionCount: z.number(),
        lastScanAt: z.string().nullable(),
      }),
    )
    expect(data.name).toBe('turnflare')
    expect(data.sessionCount).toBe(2)
    expect(data.lastScanAt).toBe(LAST_SCAN_AT)
    // config.ts 的数据根目录直读 process.env，测试里不断言具体值，只验形态
    expect(data.dataRoot.startsWith('/')).toBe(true)
  })

  it('响应带统一包络四字段且无 meta', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })

    const envelope = readEnvelope(response)
    expect(envelope.meta).toBeUndefined()
    expect(Object.keys(envelope).toSorted()).toEqual(['data', 'error', 'success'])
  })
})

describe('接口不存在', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('未知路径返回 404 与中文包络', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error).toContain('接口不存在')
  })

  it('404 话术不带查询串', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope?secret=/Users/x' })

    const envelope = readEnvelope(response)
    expect(envelope.error).not.toContain('secret')
  })

  it('未知方法走 404 而不是 500', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/health' })

    expect(response.statusCode).toBe(404)
    expect(readEnvelope(response).success).toBe(false)
  })
})

describe('sessionListItemSchema 契约', () => {
  it('列表项字段齐备', async () => {
    const repo = new FakeRepository({ sessions: [makeSessionDetail()] })
    const app = await makeTestApp({ repo })

    try {
      const response = await app.inject({ method: 'GET', url: '/api/sessions' })
      const envelope = readEnvelope(response)
      const items = parseData(envelope.data, z.array(sessionListItemSchema))
      expect(items).toHaveLength(1)
      expect(items[0]?.cost.currency).toBe('USD')
    } finally {
      await app.close()
    }
  })
})
