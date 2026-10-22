import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRepository } from '../test-support/fake-repository.js'
import { makeSessionDetail, makeSessionSeries } from '../test-support/fixtures.js'
import {
  makeTestApp,
  parseData,
  readEnvelope,
  sessionListItemSchema,
  z,
} from '../test-support/test-app.js'

const ALPHA = '-Users-che1sy-Projects-alpha'
const BETA = '-Users-che1sy-Projects-beta'

/** 详情永远读不到的仓储：用来覆盖"前缀命中但详情缺失"的兜底分支 */
class DetaillessRepository extends FakeRepository {
  override getSession(): null {
    return null
  }
}

/** 取列表项的 sessionId 序列，用于断言顺序 */
function toIds(items: readonly { sessionId: string }[]): readonly string[] {
  return items.map((item) => item.sessionId)
}

describe('GET /api/sessions', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({ repo: new FakeRepository({ sessions: makeSessionSeries(5) }) })
  })

  afterEach(async () => {
    await app.close()
  })

  it('默认按成本降序返回第一页', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions' })

    expect(response.statusCode).toBe(200)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(true)
    expect(envelope.error).toBeNull()
    const items = parseData(envelope.data, z.array(sessionListItemSchema))
    expect(items).toHaveLength(5)
    // 夹具成本递减，默认 cost 降序即创建顺序
    expect(items[0]?.cost.totalCost).toBe(2.5)
    expect(items[4]?.cost.totalCost).toBe(0.5)
  })

  it('带分页 meta', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions?limit=2' })

    const envelope = readEnvelope(response)
    expect(envelope.meta).toEqual({
      total: 5,
      page: 1,
      limit: 2,
      generatedAt: expect.any(String),
    })
    const items = parseData(envelope.data, z.array(sessionListItemSchema))
    expect(items).toHaveLength(2)
  })

  it('第二页返回剩余条目', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/sessions?limit=2&page=1' })
    const second = await app.inject({ method: 'GET', url: '/api/sessions?limit=2&page=2' })

    const firstIds = toIds(parseData(readEnvelope(first).data, z.array(sessionListItemSchema)))
    const secondEnvelope = readEnvelope(second)
    const secondIds = toIds(parseData(secondEnvelope.data, z.array(sessionListItemSchema)))

    expect(secondIds).toHaveLength(2)
    expect(secondEnvelope.meta?.page).toBe(2)
    // 两页不能有交集，否则分页就是假的
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([])
  })

  it('order=asc 反转排序', async () => {
    const desc = await app.inject({ method: 'GET', url: '/api/sessions?sort=cost&order=asc' })
    const items = parseData(readEnvelope(desc).data, z.array(sessionListItemSchema))

    expect(items[0]?.cost.totalCost).toBe(0.5)
    expect(items[4]?.cost.totalCost).toBe(2.5)
  })

  it('按项目过滤', async () => {
    const repo = new FakeRepository({
      sessions: [
        makeSessionDetail({
          sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
          projectSlug: ALPHA,
        }),
        makeSessionDetail({ sessionId: 'bbbbbbbb-0000-4000-8000-000000000002', projectSlug: BETA }),
      ],
    })
    const scoped = await makeTestApp({ repo })

    try {
      const response = await scoped.inject({ method: 'GET', url: `/api/sessions?project=${BETA}` })
      const envelope = readEnvelope(response)
      const items = parseData(envelope.data, z.array(sessionListItemSchema))

      expect(items).toHaveLength(1)
      expect(items[0]?.projectSlug).toBe(BETA)
      // total 必须与过滤后的结果一致，不能是全表总数
      expect(envelope.meta?.total).toBe(1)
    } finally {
      await scoped.close()
    }
  })

  it('按模型过滤', async () => {
    const repo = new FakeRepository({
      sessions: [
        makeSessionDetail({
          sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
          models: ['claude-opus-5-5'],
        }),
        makeSessionDetail({
          sessionId: 'bbbbbbbb-0000-4000-8000-000000000002',
          models: ['claude-haiku-4-5'],
        }),
      ],
    })
    const scoped = await makeTestApp({ repo })

    try {
      const response = await scoped.inject({
        method: 'GET',
        url: '/api/sessions?model=claude-haiku-4-5',
      })
      const items = parseData(readEnvelope(response).data, z.array(sessionListItemSchema))

      expect(items).toHaveLength(1)
      expect(items[0]?.models).toEqual(['claude-haiku-4-5'])
    } finally {
      await scoped.close()
    }
  })

  it('page 非法返回 400 并指出字段', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions?page=0' })

    expect(response.statusCode).toBe(400)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error).toContain('page')
  })

  it('sort 非法返回 400 并列出合法值', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions?sort=size' })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toBe('参数 sort 必须是 cost/tokens/recent/turns 之一')
  })

  it('limit 超过上限返回 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions?limit=500' })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toContain('limit')
  })
})

describe('GET /api/sessions/:id', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({ repo: new FakeRepository({ sessions: makeSessionSeries(5) }) })
  })

  afterEach(async () => {
    await app.close()
  })

  it('完整 id 命中返回详情', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/00000000-aaaa-4bbb-8ccc-dddddddddddd',
    })

    expect(response.statusCode).toBe(200)
    const envelope = readEnvelope(response)
    const data = parseData(
      envelope.data,
      z.object({
        sessionId: z.string(),
        projectSlug: z.string(),
        turns: z.array(z.unknown()),
        usage: z.object({ inputTokens: z.number() }),
        parseErrorCount: z.number(),
      }),
    )
    expect(data.sessionId).toBe('00000000-aaaa-4bbb-8ccc-dddddddddddd')
    expect(data.projectSlug).toBe(ALPHA)
  })

  it('前缀命中唯一会话', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions/00000003' })

    expect(response.statusCode).toBe(200)
    const data = parseData(readEnvelope(response).data, z.object({ sessionId: z.string() }))
    expect(data.sessionId).toBe('00000003-aaaa-4bbb-8ccc-dddddddddddd')
  })

  it('前缀匹配到多个会话返回 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions/0000000' })

    expect(response.statusCode).toBe(400)
    // 5 条夹具的 id 都以 0000000 开头，前缀无法定位唯一会话
    expect(readEnvelope(response).error).toContain('前缀匹配到 5 个会话')
  })

  it('不存在的会话返回 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions/ffffffff' })

    expect(response.statusCode).toBe(404)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error).toContain('未找到会话')
  })

  it('空 id 返回 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions/%20' })

    expect(response.statusCode).toBe(400)
  })

  it('前缀命中但详情读不到时按 404 收尾', async () => {
    // Arrange：一个"列表里有、详情永远 null"的仓储，模拟并发删除的竞态
    const repo = new DetaillessRepository({ sessions: makeSessionSeries(2) })
    const scoped = await makeTestApp({ repo })

    try {
      const response = await scoped.inject({
        method: 'GET',
        url: '/api/sessions/00000000-aaaa-4bbb-8ccc-dddddddddddd',
      })

      expect(response.statusCode).toBe(404)
      expect(readEnvelope(response).error).toContain('未找到会话')
    } finally {
      await scoped.close()
    }
  })
})
