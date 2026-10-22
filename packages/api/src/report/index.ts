/**
 * @turnflare/api —— 报告导出的分发与取数。
 *
 * 四种格式共用同一份 `ReportPayload`：json / markdown / csv / html 只是同一批
 * 数字的不同排版，因此取数只做一次（collectReportData），渲染各自纯函数化，
 * 不碰 HTTP、不碰数据库——渲染逻辑可以脱离服务单测。
 */

import type { ReportFormat } from '@turnflare/core'
import type { SessionRepository } from '../db/repository.js'
import type {
  UsageQuery,
  AggregatedStats,
  ModelStats,
  ProjectStats,
  TimeBucket,
  ToolStats,
} from '../types.js'
import { renderCsvReport } from './csv.js'
import { renderHtmlReport } from './html.js'
import { renderJsonReport } from './json.js'
import { renderMarkdownReport } from './markdown.js'

/** 一份报表需要的全部数据；渲染函数只依赖它 */
export interface ReportPayload {
  readonly filters?: UsageQuery
  readonly generatedAt: string
  /** Legacy overview includes sidechain; filtered totals follow `filters` and omit a separate sidechain summary. */
  readonly overview: Omit<AggregatedStats, 'sidechain'> & {
    readonly sidechain?: AggregatedStats['sidechain']
  }
  readonly models: readonly ModelStats[]
  readonly projects: readonly ProjectStats[]
  readonly tools: readonly ToolStats[]
  /** 按天的时间线，用于 HTML 里的每日成本柱状图 */
  readonly timeline: readonly TimeBucket[]
}

export interface RenderedReport {
  readonly contentType: string
  readonly body: string
}

/** 从仓储取一份报表数据；generatedAt 由调用方给定，保证包络与正文时间一致 */
export function collectReportData(
  repo: SessionRepository,
  generatedAt: string,
  filters?: UsageQuery,
): ReportPayload {
  if (filters !== undefined) {
    const data = repo.getAnalytics(filters)
    const overview: ReportPayload['overview'] = {
      sessionCount: data.sessionCount,
      turnCount: data.turnCount,
      usage: data.usage,
      cost: data.cost,
      cacheHitRate: data.cacheHitRate,
      errorRate: data.errorRate,
      firstActivityAt: data.firstActivityAt,
      lastActivityAt: data.lastActivityAt,
      byModel: data.models,
      byProject: data.projects,
      byDay: data.days,
      byHour: [],
      toolUsage: data.tools,
    }
    return {
      generatedAt,
      filters: data.filters,
      overview,
      models: data.models,
      projects: data.projects,
      tools: data.tools,
      timeline: data.days,
    }
  }
  return {
    generatedAt,
    overview: repo.getOverview(),
    models: repo.getModelStats(),
    projects: repo.getProjectStats(),
    tools: repo.getToolStats(),
    timeline: repo.getTimeline({ granularity: 'day' }),
  }
}

/**
 * 格式 → 渲染器。
 *
 * 用查表而不是 switch：新增一种格式时漏注册会直接编译报错，
 * 不会静默退化到某个默认格式上。
 */
const RENDERERS: Readonly<Record<ReportFormat, (payload: ReportPayload) => RenderedReport>> = {
  json: renderJsonReport,
  markdown: renderMarkdownReport,
  csv: renderCsvReport,
  html: renderHtmlReport,
}

/** 按格式渲染；调用方必须已经用 zod 校验过 format */
export function renderReport(payload: ReportPayload, format: ReportFormat): RenderedReport {
  return RENDERERS[format](payload)
}
