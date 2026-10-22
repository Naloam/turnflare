/**
 * @turnflare/api —— 统计路由。
 *
 * 五个端点都只是仓储的薄封装：统计口径（去重、排除侧链、排除合成模型）
 * 全在数据层与 core 里实现，HTTP 层不做任何数字加工——同一份数字在 API、
 * CLI、Web 三端才可能一致。
 */

import type { FastifyInstance } from 'fastify'
import type { SessionRepository } from '../db/repository.js'
import type { TimelinePayload } from '../types.js'
import { ApiError } from '../plugins/error-handler.js'
import { parseUsageQuery, parseTimelineQuery } from '../schemas/index.js'
import { sendData } from './envelope.js'

export interface StatsRouteDeps {
  readonly repo: SessionRepository
}

export function registerStatsRoutes(app: FastifyInstance, deps: StatsRouteDeps): void {
  app.get('/api/stats/analytics/options', async (_request, reply) =>
    sendData(reply, deps.repo.getAnalyticsOptions()),
  )

  app.get('/api/stats/analytics', async (request, reply) => {
    const query = parseUsageQuery(request.query)
    if (!query.ok) throw new ApiError(400, query.error)
    return sendData(reply, deps.repo.getAnalytics(query.value))
  })

  app.get('/api/stats/overview', async (_request, reply) => {
    return sendData(reply, deps.repo.getOverview())
  })

  app.get('/api/stats/models', async (_request, reply) => {
    return sendData(reply, deps.repo.getModelStats())
  })

  app.get('/api/stats/projects', async (_request, reply) => {
    return sendData(reply, deps.repo.getProjectStats())
  })

  app.get('/api/stats/tools', async (_request, reply) => {
    return sendData(reply, deps.repo.getToolStats())
  })

  app.get('/api/stats/timeline', async (request, reply) => {
    const parsed = parseTimelineQuery(request.query)
    if (!parsed.ok) {
      throw new ApiError(400, parsed.error)
    }
    const buckets = deps.repo.getTimeline(parsed.value)
    const payload: TimelinePayload = { granularity: parsed.value.granularity, buckets }
    return sendData(reply, payload)
  })
}
