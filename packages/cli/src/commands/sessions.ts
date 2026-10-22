/**
 * `turnflare sessions` —— 会话列表。
 *
 * 取数只有一句 `repo.listSessions`：排序、分页、项目过滤的语义都在仓储里，
 * CLI 不重复实现第二套（否则两张表会给出不同顺序）。
 */
import { SUCCESS } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { SessionsOptions } from '../options.js'
import { MAX_SESSION_LIMIT } from '../options.js'
import type { SessionListItem, SessionsQuery } from '../api-types.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure } from './shared.js'
import { renderRows } from '../render/table.js'
import {
  displayModels,
  displayRelativeTime,
  formatCost,
  formatTokens,
  formatWithThousandsSeparator,
  shortSessionId,
  usageTotal,
} from '../format.js'

export type SessionsDeps = StorageDeps

const HEAD: readonly string[] = ['会话 ID', '项目', '模型', '时间', '轮次', 'Token', '成本']

const ALIGNS = ['left', 'left', 'left', 'left', 'right', 'right', 'right'] as const

const EMPTY_HINT = '暂无会话数据。请先运行 `turnflare scan` 扫描会话记录。'

function toRow(item: SessionListItem, now: Date): readonly string[] {
  return [
    shortSessionId(item.sessionId),
    item.projectSlug,
    displayModels(item.models),
    displayRelativeTime(item.startedAt, now),
    formatWithThousandsSeparator(item.turnCount),
    formatTokens(usageTotal(item.usage)),
    formatCost(item.cost.totalCost),
  ]
}

/**
 * 组装仓储查询。
 *
 * `limit` 的上限在 `argv.ts` 解析时就已经拦掉了（与仓储 `normalizeSessionsQuery`
 * 的夹取口径一致），这里不再夹第二次：同一个上限写两处必然漂移。
 */
function buildQuery(options: SessionsOptions): SessionsQuery {
  return {
    page: 1,
    limit: options.limit,
    sort: options.sort,
    order: 'desc',
    ...(options.project === undefined ? {} : { project: options.project }),
  }
}

/**
 * "还有更多"的两种说法。
 *
 * 条数没到单页上限时提示调大 `--limit`；已经贴着上限时不能这么说——
 * argv 会拒绝 `--limit 201`，那句建议必然失败。改说上限在哪，
 * 让用户知道剩下的数据要么换查询条件（`--project` / `--sort`），要么分页取。
 */
function moreHint(shown: number, limit: number): string {
  if (limit < MAX_SESSION_LIMIT) {
    return `，显示前 ${String(shown)} 场，可用 --limit 调整`
  }
  return `，已达单页上限 ${String(MAX_SESSION_LIMIT)}`
}

function renderSummary(
  total: number,
  shown: number,
  limit: number,
  project: string | undefined,
): string {
  const scope = project === undefined ? '' : `（项目：${project}）`
  if (shown >= total) {
    return `共 ${String(total)} 场会话${scope}`
  }
  return `共 ${String(total)} 场会话${scope}${moreHint(shown, limit)}`
}

export function createSessionsCommand(deps: SessionsDeps): Command<SessionsOptions> {
  return {
    name: 'sessions',
    description: '会话列表',
    usage: 'turnflare sessions [--limit N] [--project SLUG] [--sort KEY]',
    run: (ctx: CliContext, options: SessionsOptions): CommandResult => {
      const storage = openStorageFromEnv(ctx.env, deps, { requireExisting: true })
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      const now = new Date()
      try {
        const { items, total } = storage.repo.listSessions(buildQuery(options))

        if (options.json) {
          ctx.stdout(`${JSON.stringify({ total, items }, null, 2)}\n`)
          return SUCCESS
        }

        ctx.stdout(`${renderSummary(total, items.length, options.limit, options.project)}\n\n`)
        ctx.stdout(
          `${renderRows(
            HEAD,
            items.map((item) => toRow(item, now)),
            EMPTY_HINT,
            ALIGNS,
          )}\n`,
        )
        return SUCCESS
      } catch (error: unknown) {
        return runtimeFailure(ctx, error, '读取会话列表失败')
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
