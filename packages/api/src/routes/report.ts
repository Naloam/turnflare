/**
 * @turnflare/api —— 报告导出路由。
 *
 * 格式先用 zod 校验再取数：格式不认识时立刻 400，不必白跑一趟数据库。
 * 响应的 Content-Type 由渲染器决定——CSV 与 HTML 显然不该按 JSON 发。
 */

import type { FastifyInstance } from 'fastify'
import type { SessionRepository } from '../db/repository.js'
import { ApiError } from '../plugins/error-handler.js'
import { parseUsageQuery, parseReportFormat } from '../schemas/index.js'
import { collectReportData, renderReport } from '../report/index.js'

export interface ReportRouteDeps {
  readonly repo: SessionRepository
}

export function registerReportRoutes(app: FastifyInstance, deps: ReportRouteDeps): void {
  app.get('/api/report', async (request, reply) => {
    const parsed = parseReportFormat(request.query)
    if (!parsed.ok) {
      throw new ApiError(400, parsed.error)
    }
    const filters = parseUsageQuery(request.query)
    if (!filters.ok) throw new ApiError(400, filters.error)
    const hasFilters = Object.keys(filters.value).length > 0
    const payload = collectReportData(
      deps.repo,
      new Date().toISOString(),
      hasFilters ? filters.value : undefined,
    )
    const rendered = renderReport(payload, parsed.value)
    return reply.type(rendered.contentType).send(rendered.body)
  })
}
