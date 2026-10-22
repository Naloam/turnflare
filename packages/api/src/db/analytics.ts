import { cacheHitRate, toolErrorRate } from '@turnflare/core'
import type { AnalyticsOptions, AnalyticsPayload, UsageQuery } from '../types.js'
import type { RepositoryDeps } from './repository-deps.js'
import {
  foldCosts,
  foldModelStats,
  foldUsage,
  groupRowsBy,
  readIntegerFrom,
  readTextFieldFrom,
  sumRequestCount,
  toProjectStats,
  toTimeBucket,
  toToolStats,
} from './mapper.js'
import { compareModelStats, compareProjects } from './repository-helpers.js'

/** Bound parameters and one shared cohort keep summary, tools and exports in agreement. */
function cohort(query: UsageQuery): { sql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  if (query.chain !== 'all') {
    where.push('t.is_sidechain = ?')
    params.push(query.chain === 'side' ? 1 : 0)
  }
  for (const [value, clause] of [
    [query.since, 't.timestamp >= ?'],
    [query.until, 't.timestamp < ?'],
    [query.project, 's.project_slug = ?'],
    [query.model, 't.model = ?'],
  ] as const) {
    if (value !== undefined) {
      where.push(clause)
      params.push(value)
    }
  }
  return {
    sql: `WITH selected AS (SELECT t.*, s.project_slug FROM turns t JOIN sessions s ON s.session_id = t.session_id ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`})`,
    params,
  }
}

/** Aggregate in SQLite; never load transcript text or individual tool results for analytics. */
export function readAnalytics(deps: RepositoryDeps, query: UsageQuery): AnalyticsPayload {
  const { sql, params } = cohort(query)
  const rows = deps.db
    .prepare(
      `${sql}
    SELECT project_slug, session_id, model, speed, substr(timestamp, 1, 10) AS bucket,
      COUNT(*) AS turn_count, COUNT(model) AS request_count,
      MIN(timestamp) AS first_at, MAX(timestamp) AS last_at,
      SUM(input_tokens) AS input_tokens, SUM(cache_creation_tokens) AS cache_creation_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens, SUM(output_tokens) AS output_tokens,
      SUM(thinking_tokens) AS thinking_tokens
    FROM selected GROUP BY project_slug, session_id, model, speed, bucket
    ORDER BY bucket ASC`,
    )
    .all(...params)
  const priced = rows.filter((row) => readTextFieldFrom(row, 'model') !== null)
  const tools = deps.db
    .prepare(
      `${sql}
    SELECT ti.tool_name, COUNT(*) AS call_count, SUM(ti.is_error) AS error_count,
      SUM(ti.result_bytes) AS total_result_bytes
    FROM tool_invocations ti JOIN selected t ON t.uuid = ti.turn_uuid
    GROUP BY ti.tool_name ORDER BY call_count DESC, ti.tool_name ASC`,
    )
    .all(...params)
    .map(toToolStats)
  const usage = foldUsage(priced)
  const first = rows
    .flatMap((row) => {
      const v = readTextFieldFrom(row, 'first_at')
      return v === null ? [] : [v]
    })
    .toSorted()
  const last = rows
    .flatMap((row) => {
      const v = readTextFieldFrom(row, 'last_at')
      return v === null ? [] : [v]
    })
    .toSorted()
  return {
    filters: { ...query, chain: query.chain ?? 'main' },
    sessionCount: groupRowsBy(rows, 'session_id').size,
    turnCount: rows.reduce<number>((n, row) => n + readIntegerFrom(row, 'turn_count'), 0),
    requestCount: sumRequestCount(priced),
    usage,
    cost: foldCosts(priced),
    models: foldModelStats(priced).toSorted(compareModelStats),
    projects: [...groupRowsBy(rows, 'project_slug')]
      .map(([slug, projectRows]) => ({
        ...toProjectStats(
          slug,
          projectRows.filter((row) => readTextFieldFrom(row, 'model') !== null),
        ),
        sessionCount: groupRowsBy(projectRows, 'session_id').size,
      }))
      .toSorted(compareProjects),
    days: [...groupRowsBy(priced, 'bucket')].map(([day, dayRows]) => toTimeBucket(day, dayRows)),
    tools,
    cacheHitRate: cacheHitRate(usage),
    errorRate: toolErrorRate(tools),
    firstActivityAt: first[0] ?? null,
    lastActivityAt: last.at(-1) ?? null,
  }
}

export function readAnalyticsOptions(deps: RepositoryDeps): AnalyticsOptions {
  const values = (sql: string, column: string) =>
    deps.db
      .prepare(sql)
      .all()
      .flatMap((row) => {
        const value = readTextFieldFrom(row, column)
        return value === null ? [] : [value]
      })
  return {
    projects: values(
      'SELECT DISTINCT project_slug FROM sessions ORDER BY project_slug',
      'project_slug',
    ),
    models: values(
      'SELECT DISTINCT model FROM turns WHERE model IS NOT NULL ORDER BY model',
      'model',
    ),
  }
}
