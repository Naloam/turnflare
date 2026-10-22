import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRepository } from '../test-support/fake-repository.js'
import { makeAggregatedStats, makeModelStats, makeTimeBucket } from '../test-support/fixtures.js'
import { makeTestApp, readEnvelope, z } from '../test-support/test-app.js'

describe('GET /api/report', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          byDay: [makeTimeBucket({ bucket: '2026-10-19' })],
        }),
      }),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('json 格式返回包络 JSON', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=json' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(true)
    expect(envelope.data).toMatchObject({
      generatedAt: expect.any(String),
      overview: expect.objectContaining({ sessionCount: 3 }),
    })
  })

  it('markdown 格式返回中文报表', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=markdown' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/markdown')
    expect(response.payload).toContain('# Turnflare 用量报表')
    expect(response.payload).toContain('## 模型分布')
  })

  it('csv 格式带 BOM 以便 Excel 识别中文', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=csv' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.payload.charCodeAt(0)).toBe(0xfeff)
    expect(response.payload).toContain('总览')
  })

  it('html 格式是自包含单文件', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=html' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.payload).toContain('<html lang="zh-CN">')
    expect(response.payload).toContain('<svg')
  })

  it('未知格式返回 400 并列出合法值', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=pdf' })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toBe('参数 format 必须是 json/markdown/csv/html 之一')
  })

  it('缺少 format 返回 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report' })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toContain('format')
  })

  it('HTML 报表转义来自数据的字符串', async () => {
    const scoped = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          byModel: [makeModelStats({ model: '<script>alert(1)</script>' })],
        }),
      }),
    })

    try {
      const response = await scoped.inject({ method: 'GET', url: '/api/report?format=html' })

      expect(response.payload).not.toContain('<script>alert(1)</script>')
      expect(response.payload).toContain('&lt;script&gt;')
    } finally {
      await scoped.close()
    }
  })

  it('json 报表的 data 含全部五个分块', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/report?format=json' })

    const data = z
      .object({
        generatedAt: z.string(),
        overview: z.object({ sessionCount: z.number() }),
        models: z.array(z.unknown()),
        projects: z.array(z.unknown()),
        tools: z.array(z.unknown()),
        timeline: z.array(z.unknown()),
      })
      .safeParse(readEnvelope(response).data)

    expect(data.success).toBe(true)
  })
})
