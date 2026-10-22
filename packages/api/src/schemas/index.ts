/**
 * @turnflare/api —— 请求参数校验。
 *
 * 边界原则：HTTP 传进来的 querystring / params / body 一律按 `unknown` 接住，
 * 用 zod 收窄成 `types.ts` 里的领域查询对象后才允许进入业务层。
 *
 * 本文件不依赖 Fastify、不抛异常：校验结果以 `ParseResult` 交还调用方，
 * 由路由决定"这句话怎么进响应包络"。这样校验逻辑可以脱离 HTTP 栈单测。
 */

import { z } from 'zod'
import type { ReportFormat } from '@turnflare/core'
import type { UsageQuery } from '../types.js'
import type { ScanRequest, SessionChain, TimelineQuery, ValidatedSessionsQuery } from '../types.js'

// ─── 白名单常量 ──────────────────────────────────────────────────────────────

/** 会话列表排序字段；与 db/queries.ts 的 resolveSortColumn 一一对应 */
export const SESSIONS_SORT_VALUES = ['cost', 'tokens', 'recent', 'turns'] as const

/** 排序方向 */
export const SESSIONS_ORDER_VALUES = ['asc', 'desc'] as const

/** 时间线粒度 */
export const TIMELINE_GRANULARITIES = ['hour', 'day'] as const

/** 报告导出格式；与 core 的 ReportFormat 保持一致 */
export const REPORT_FORMATS = ['json', 'markdown', 'csv', 'html'] as const

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MIN_SLUG_LENGTH = 1

/** 一条错误信息里最多报几个字段：全部报出会刷屏，用户也修不过来 */
const MAX_REPORTED_ISSUES = 3

const sessionChainSchema = z.object({
  chain: z.enum(['all', 'main', 'side']).default('all'),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
})

export function parseSessionChain(
  raw: unknown,
): ParseResult<{ chain: SessionChain; page: number }> {
  return toParseResult(sessionChainSchema, raw)
}

/** 校验结果：成功给窄化后的值，失败给一句中文可读信息 */
export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/**
 * 单个 issue → 中文短句。
 *
 * 枚举类错误单独处理：zod 默认给的是 `Invalid option: expected one of "a"|"b"`，
 * 既不是中文也不符合 docs/API.md 的示例话术，因此按 `必须是 a/b 之一` 重写。
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.map((segment) => String(segment)).join('.')
  const prefix = field.length === 0 ? '请求参数' : `参数 ${field}`
  if (issue.code === 'invalid_value') {
    const options = issue.values.map((value) => String(value)).join('/')
    return `${prefix} 必须是 ${options} 之一`
  }
  return `${prefix}${issue.message}`
}

/** 把 zod 的 issue 列表压成一句中文可读信息，并指出是哪个字段 */
function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map(describeIssue).join('；')
}

function toParseResult<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const result = schema.safeParse(raw)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  return { ok: false, error: describeIssues(result.error) }
}

/**
 * 校验"可选的 ISO 时间字符串"。
 *
 * 不要求严格 RFC 3339：`2026-10-01` 与 `2026-10-01T00:00:00.000Z` 都放过，
 * 只挡掉明显不是时间的东西——时间过滤是给人用的便利功能，不是安全边界。
 */
const optionalTimestamp = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: '必须是合法的 ISO 时间字符串，例如 2026-10-01T00:00:00.000Z',
  })

// ─── 会话列表查询 ────────────────────────────────────────────────────────────

const sessionsQuerySchema = z.object({
  // 查询串里的数字都是字符串，必须 coerce；空串会被 Number('') 变成 0，
  // 从而被 min(1) 挡下，不会静默变成第 0 页。
  page: z.coerce.number().int().min(1, '必须是 ≥ 1 的整数').default(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1, '必须是 1-200 的整数')
    .max(MAX_LIMIT, '必须是 1-200 的整数')
    .default(DEFAULT_LIMIT),
  project: z.string().trim().min(MIN_SLUG_LENGTH).optional(),
  model: z.string().trim().min(MIN_SLUG_LENGTH).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(SESSIONS_SORT_VALUES).default('cost'),
  order: z.enum(SESSIONS_ORDER_VALUES).default('desc'),
})

export function parseSessionsQuery(raw: unknown): ParseResult<ValidatedSessionsQuery> {
  const result = toParseResult(sessionsQuerySchema, raw)
  if (!result.ok) {
    return result
  }
  const { page, limit, project, model, search, sort, order } = result.value
  // exactOptionalPropertyTypes：没传的过滤条件必须整个键都不出现，
  // 不能塞一个 undefined 进对象里——那会让下游的 `!== undefined` 判断失效。
  return {
    ok: true,
    value: {
      page,
      limit,
      sort,
      order,
      ...(project === undefined ? {} : { project }),
      ...(model === undefined ? {} : { model }),
      ...(search === undefined ? {} : { search }),
    },
  }
}

// ─── 时间线查询 ──────────────────────────────────────────────────────────────

const timelineQuerySchema = z.object({
  granularity: z.enum(TIMELINE_GRANULARITIES).default('day'),
  since: optionalTimestamp.optional(),
  until: optionalTimestamp.optional(),
  project: z.string().trim().min(MIN_SLUG_LENGTH).optional(),
})

export function parseTimelineQuery(raw: unknown): ParseResult<TimelineQuery> {
  const result = toParseResult(timelineQuerySchema, raw)
  if (!result.ok) {
    return result
  }
  const { granularity, since, until, project } = result.value
  return {
    ok: true,
    value: {
      granularity,
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      ...(project === undefined ? {} : { project }),
    },
  }
}

// ─── 扫描请求体 ──────────────────────────────────────────────────────────────

const scanBodySchema = z.object({
  rootDir: z.string().trim().min(1, '必须是非空字符串').optional(),
  projectSlugs: z.array(z.string().trim().min(1)).optional(),
  since: optionalTimestamp.optional(),
  force: z.boolean().default(false),
})

/** 空 body（`undefined` / `null`）等同 `{}`：所有字段本来就是可选的 */
function normalizeBody(raw: unknown): unknown {
  return raw === undefined || raw === null ? {} : raw
}

export function parseScanBody(raw: unknown): ParseResult<ScanRequest> {
  const result = toParseResult(scanBodySchema, normalizeBody(raw))
  if (!result.ok) {
    return result
  }
  const { rootDir, projectSlugs, since, force } = result.value
  return {
    ok: true,
    value: {
      force,
      ...(rootDir === undefined ? {} : { rootDir }),
      ...(projectSlugs === undefined ? {} : { projectSlugs }),
      ...(since === undefined ? {} : { since }),
    },
  }
}

// ─── 报告格式 ────────────────────────────────────────────────────────────────

const reportFormatSchema = z.object({
  format: z.enum(REPORT_FORMATS),
})

export function parseReportFormat(raw: unknown): ParseResult<ReportFormat> {
  const result = toParseResult(reportFormatSchema, raw)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: result.value.format }
}

// ─── 路径参数 ────────────────────────────────────────────────────────────────

const sessionIdSchema = z.object({
  id: z.string().trim().min(1, '不能为空').max(64, '长度不能超过 64 个字符'),
})

/** 会话 id 支持前缀匹配，因此这里只校验形态，不校验长度是否等于完整 uuid */
export function parseSessionId(raw: unknown): ParseResult<string> {
  const result = toParseResult(sessionIdSchema, raw)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: result.value.id }
}

// ─── 扫描任务 id ─────────────────────────────────────────────────────────────

const jobIdSchema = z.object({
  jobId: z.string().trim().min(1, '不能为空').max(64, '长度不能超过 64 个字符'),
})

export function parseJobId(raw: unknown): ParseResult<string> {
  const result = toParseResult(jobIdSchema, raw)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: result.value.jobId }
}

/** Analytics bounds are normalized to fixed-width UTC before SQLite string comparisons. */
const analyticsQuerySchema = z
  .object({
    since: z.iso
      .datetime({ offset: true })
      .or(z.iso.date())
      .transform((v) => new Date(v).toISOString())
      .optional(),
    until: z.iso
      .datetime({ offset: true })
      .or(z.iso.date())
      .transform((v) => new Date(v).toISOString())
      .optional(),
    project: z.string().trim().min(1).max(1000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    chain: z.enum(['all', 'main', 'side']).optional(),
  })
  .refine((v) => v.since === undefined || v.until === undefined || v.since < v.until, {
    message: 'since must precede until',
    path: ['until'],
  })

export function parseUsageQuery(raw: unknown): ParseResult<UsageQuery> {
  const result = toParseResult(analyticsQuerySchema, raw)
  if (!result.ok) return result
  const { since, until, project, model, chain } = result.value
  return {
    ok: true,
    value: {
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      ...(project === undefined ? {} : { project }),
      ...(model === undefined ? {} : { model }),
      ...(chain === undefined ? {} : { chain }),
    },
  }
}
