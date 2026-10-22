import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRepository } from '../test-support/fake-repository.js'
import {
  makeAggregatedStats,
  makeModelStats,
  makeProjectStats,
  makeSidechainSummary,
  makeTimeBucket,
  makeToolStats,
  makeUsage,
} from '../test-support/fixtures.js'
import { makeTestApp, parseData, readEnvelope, z } from '../test-support/test-app.js'

const costBreakdownSchema = z.object({
  totalCost: z.number(),
  currency: z.string(),
})

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
})

/** 侧链汇总的形状；四个字段都在，缺一个就说明响应把侧链吞了 */
const sidechainSchema = z.object({
  turnCount: z.number(),
  requestCount: z.number(),
  usage: usageSchema,
  cost: costBreakdownSchema,
})

describe('GET /api/stats/overview', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          sessionCount: 53,
          turnCount: 8421,
          byModel: [makeModelStats({ model: 'claude-opus-5-5' })],
          byProject: [makeProjectStats({ projectSlug: '-Users-a-b' })],
          byDay: [
            makeTimeBucket({ bucket: '2026-10-19' }),
            makeTimeBucket({ bucket: '2026-10-18' }),
          ],
          sidechain: makeSidechainSummary({
            turnCount: 24378,
            requestCount: 1986,
            usage: makeUsage({ inputTokens: 459_200_000, outputTokens: 12_345 }),
          }),
        }),
      }),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('返回聚合总览', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/overview' })

    expect(response.statusCode).toBe(200)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(true)
    const data = parseData(
      envelope.data,
      z.object({
        sessionCount: z.number(),
        turnCount: z.number(),
        usage: usageSchema,
        cost: costBreakdownSchema,
        byModel: z.array(z.object({ model: z.string(), requestCount: z.number() })),
        byProject: z.array(z.object({ projectSlug: z.string() })),
        byDay: z.array(z.object({ bucket: z.string() })),
        toolUsage: z.array(z.object({ toolName: z.string(), callCount: z.number() })),
        cacheHitRate: z.number(),
        errorRate: z.number(),
        firstActivityAt: z.string().nullable(),
        lastActivityAt: z.string().nullable(),
        sidechain: sidechainSchema,
      }),
    )
    expect(data.sessionCount).toBe(53)
    expect(data.turnCount).toBe(8421)
    expect(data.byModel[0]?.model).toBe('claude-opus-5-5')
    expect(data.byDay).toHaveLength(2)
  })

  it('带上侧链汇总，且不影响主链字段', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/overview' })

    const data = parseData(
      readEnvelope(response).data,
      z.object({ turnCount: z.number(), sidechain: sidechainSchema }),
    )
    expect(data.sidechain.turnCount).toBe(24378)
    expect(data.sidechain.requestCount).toBe(1986)
    expect(data.sidechain.usage.inputTokens).toBe(459_200_000)
    expect(data.sidechain.usage.outputTokens).toBe(12_345)
    // 主链字段保持原样：侧链是并列的一份，不是把两侧加在一起
    expect(data.turnCount).toBe(8421)
  })

  it('不带 meta：只有列表端点才有分页信息', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/overview' })

    expect(readEnvelope(response).meta).toBeUndefined()
  })
})

describe('GET /api/stats/models 与 /api/stats/projects', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          byModel: [makeModelStats({ model: 'claude-opus-5-5', requestCount: 10 })],
          byProject: [makeProjectStats({ projectSlug: '-Users-a-b', sessionCount: 7 })],
        }),
      }),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('返回模型分布数组', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/models' })

    const data = parseData(
      readEnvelope(response).data,
      z.array(z.object({ model: z.string(), requestCount: z.number(), cost: costBreakdownSchema })),
    )
    expect(data).toHaveLength(1)
    expect(data[0]?.requestCount).toBe(10)
  })

  it('返回项目分布数组', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/projects' })

    const data = parseData(
      readEnvelope(response).data,
      z.array(z.object({ projectSlug: z.string(), sessionCount: z.number() })),
    )
    expect(data[0]?.sessionCount).toBe(7)
  })
})

describe('GET /api/stats/tools', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          toolUsage: [makeToolStats({ toolName: 'Bash', callCount: 812, errorCount: 14 })],
        }),
      }),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('返回工具调用统计', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/tools' })

    const data = parseData(
      readEnvelope(response).data,
      z.array(
        z.object({
          toolName: z.string(),
          callCount: z.number(),
          errorCount: z.number(),
          totalResultBytes: z.number(),
        }),
      ),
    )
    expect(data[0]?.toolName).toBe('Bash')
    expect(data[0]?.callCount).toBe(812)
    expect(data[0]?.errorCount).toBe(14)
  })
})

describe('GET /api/stats/timeline', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await makeTestApp({
      repo: new FakeRepository({
        stats: makeAggregatedStats({
          byHour: [
            makeTimeBucket({ bucket: '2026-10-19T08:00:00Z' }),
            makeTimeBucket({ bucket: '2026-10-19T09:00:00Z' }),
          ],
          byDay: [
            makeTimeBucket({ bucket: '2026-10-19' }),
            makeTimeBucket({ bucket: '2026-10-18' }),
            makeTimeBucket({ bucket: '2026-10-17' }),
          ],
        }),
      }),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('默认按天返回粒度与桶', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/timeline' })

    const data = parseData(
      readEnvelope(response).data,
      z.object({
        granularity: z.enum(['hour', 'day']),
        buckets: z.array(z.object({ bucket: z.string(), requestCount: z.number() })),
      }),
    )
    expect(data.granularity).toBe('day')
    expect(data.buckets).toHaveLength(3)
  })

  it('granularity=hour 切换到小时桶', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/timeline?granularity=hour',
    })

    const data = parseData(
      readEnvelope(response).data,
      z.object({
        granularity: z.enum(['hour', 'day']),
        buckets: z.array(z.object({ bucket: z.string() })),
      }),
    )
    expect(data.granularity).toBe('hour')
    expect(data.buckets[0]?.bucket).toBe('2026-10-19T08:00:00Z')
  })

  it('since / until 收窄时间范围', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/timeline?since=2026-10-18&until=2026-10-19',
    })

    const data = parseData(
      readEnvelope(response).data,
      z.object({ buckets: z.array(z.object({ bucket: z.string() })) }),
    )
    expect(data.buckets.map((bucket) => bucket.bucket)).toEqual(['2026-10-18'])
  })

  it('granularity 非法返回 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/timeline?granularity=week',
    })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toBe('参数 granularity 必须是 hour/day 之一')
  })

  it('until 不是时间返回 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/stats/timeline?until=上周' })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toContain('until')
  })
})
