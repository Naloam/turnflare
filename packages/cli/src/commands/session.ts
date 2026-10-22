/**
 * `turnflare session <id>` —— 单会话详情。
 *
 * ID 支持前缀匹配：真实会话 ID 是 36 字符的 UUID，让人完整敲一遍不现实。
 * 做法是先按完整 ID 精确查（一次查询），查不到再翻列表做前缀匹配，
 * 匹配到多个时明确告诉用户"再输长一点"，而不是悄悄挑一个。
 */
import { aggregateTools, formatBytes } from '@turnflare/core'
import type { Turn } from '@turnflare/core'
import type { SessionDetail, SessionListItem, SessionRepository } from '../api-types.js'
import { SUCCESS, failure } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import { SESSION_TURN_PREVIEW_LIMIT } from '../options.js'
import type { SessionOptions } from '../options.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure } from './shared.js'
import { renderRows } from '../render/table.js'
import {
  UNKNOWN,
  sanitizeForTerminal,
  displayModels,
  displayTimestamp,
  displayWidth,
  formatCost,
  formatTokens,
  localTimezoneOffsetMinutes,
  padDisplayEnd,
  shortSessionId,
  truncate,
  usageTotal,
} from '../format.js'

export type SessionDeps = StorageDeps

/** 前缀匹配时的分页大小：够大则绝大多数情况一页就够 */
const PREFIX_PAGE_SIZE = 200

/**
 * 仓储单次最多带回的轮次数（api 的 `MAX_TURNS_PER_SESSION`）。
 * 轮次总数因此可能大于 `turns.length`，展示时要说明，否则用户会以为数据丢了。
 */
const MAX_TURNS_FROM_STORAGE = 500

/** 轮次预览的字符上限：表格列宽有限，长文本截断 */
const PREVIEW_MAX_CHARS = 60

const TURN_HEAD: readonly string[] = ['#', '角色', '时间', '模型', '预览']

const TURN_ALIGNS = ['right', 'left', 'left', 'left', 'left'] as const

const TOOL_HEAD: readonly string[] = ['工具', '调用次数', '出错', '结果体积']

const TOOL_ALIGNS = ['left', 'right', 'right', 'right'] as const

const EMPTY_TURN_HINT = '该会话没有任何轮次。'

const EMPTY_TOOL_HINT = '该会话没有任何工具调用。'

const EMPTY_PREVIEW = '（无文本内容）'

const ROLE_LABELS: Readonly<Record<string, string>> = {
  user: '用户',
  assistant: '助手',
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/**
 * 前缀匹配的结果。
 *
 * 三种结局必须分开：找不到（用户输错了）、有多个（输得太短）、正好一个。
 * 把后两种合成"失败"会让用户不知道该多敲几位还是换个 ID。
 */
type ResolveResult =
  | { readonly kind: 'found'; readonly detail: SessionDetail }
  | { readonly kind: 'none'; readonly prefix: string }
  | { readonly kind: 'ambiguous'; readonly prefix: string; readonly count: number }

function matchesPrefix(sessionId: string, prefix: string): boolean {
  return sessionId.toLowerCase().startsWith(prefix.toLowerCase())
}

/** 翻页找前缀匹配；一页凑够两个匹配就停（已经足以判定歧义） */
function findCandidates(repo: SessionRepository, prefix: string): readonly SessionListItem[] {
  const candidates: SessionListItem[] = []
  let page = 1
  for (;;) {
    const { items, total } = repo.listSessions({
      page,
      limit: PREFIX_PAGE_SIZE,
      sort: 'recent',
      order: 'desc',
    })
    candidates.push(...items.filter((item) => matchesPrefix(item.sessionId, prefix)))
    if (candidates.length > 1 || page * PREFIX_PAGE_SIZE >= total) {
      return candidates
    }
    page += 1
  }
}

function resolveSession(repo: SessionRepository, id: string): ResolveResult {
  const exact = repo.getSession(id)
  if (exact !== null) {
    return { kind: 'found', detail: exact }
  }
  const candidates = findCandidates(repo, id)
  if (candidates.length === 0) {
    return { kind: 'none', prefix: id }
  }
  const only = candidates[0]
  if (candidates.length === 1 && only !== undefined) {
    const detail = repo.getSession(only.sessionId)
    return detail === null ? { kind: 'none', prefix: id } : { kind: 'found', detail }
  }
  return { kind: 'ambiguous', prefix: id, count: candidates.length }
}

/** 轮次数；触到仓储上限时注明"还有更多"，避免用户以为数据丢失 */
function formatTurnCount(turnCount: number): string {
  return turnCount >= MAX_TURNS_FROM_STORAGE
    ? `${String(turnCount)}+（仅取回前 ${String(MAX_TURNS_FROM_STORAGE)} 条）`
    : String(turnCount)
}

/** 元信息行；用元组而不是 string[]，解构时不必应付 noUncheckedIndexedAccess */
type MetaRow = readonly [label: string, value: string]

function renderMeta(detail: SessionDetail, timezoneOffsetMinutes: number): string {
  const rows: readonly MetaRow[] = [
    ['项目', detail.projectSlug],
    ['目录', detail.cwd ?? UNKNOWN],
    ['分支', detail.gitBranch ?? UNKNOWN],
    ['模型', displayModels(detail.models)],
    ['开始', displayTimestamp(detail.startedAt, timezoneOffsetMinutes)],
    ['结束', displayTimestamp(detail.endedAt, timezoneOffsetMinutes)],
    ['轮次', formatTurnCount(detail.turns.length)],
    ['Token', formatTokens(usageTotal(detail.usage))],
    ['成本', formatCost(detail.cost.totalCost)],
    ['解析错误', String(detail.parseErrorCount)],
  ]
  const width = Math.max(...rows.map(([label]) => displayWidth(label)))
  return rows.map(([label, value]) => `  ${padDisplayEnd(label, width)}  ${value}`).join('\n')
}

function previewOf(turn: Turn): string {
  const text = sanitizeForTerminal(turn.textPreview)
  // tool_result 之类的记录没有正文，留空格会让表格看起来像坏了
  return text === '' ? EMPTY_PREVIEW : truncate(text, PREVIEW_MAX_CHARS)
}

function renderTurns(detail: SessionDetail, timezoneOffsetMinutes: number): string {
  const shown = detail.turns.slice(0, SESSION_TURN_PREVIEW_LIMIT)
  const rows = shown.map((turn, index) => [
    String(index + 1),
    roleLabel(turn.role),
    displayTimestamp(turn.timestamp, timezoneOffsetMinutes),
    turn.model ?? UNKNOWN,
    previewOf(turn),
  ])
  const table = renderRows(TURN_HEAD, rows, EMPTY_TURN_HINT, TURN_ALIGNS)
  const hidden = detail.turns.length - shown.length
  const note =
    hidden > 0
      ? `\n（仅显示前 ${String(SESSION_TURN_PREVIEW_LIMIT)} 条，其余 ${String(hidden)} 条已省略）`
      : ''
  return `${table}${note}`
}

function renderTools(detail: SessionDetail): string {
  const rows = aggregateTools(detail.turns).map((tool) => [
    tool.toolName,
    String(tool.callCount),
    String(tool.errorCount),
    formatBytes(tool.totalResultBytes),
  ])
  return renderRows(TOOL_HEAD, rows, EMPTY_TOOL_HINT, TOOL_ALIGNS)
}

export function createSessionCommand(deps: SessionDeps): Command<SessionOptions> {
  return {
    name: 'session',
    description: '单会话详情',
    usage: 'turnflare session <id>',
    run: (ctx: CliContext, options: SessionOptions): CommandResult => {
      const storage = openStorageFromEnv(ctx.env, deps, { requireExisting: true })
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      try {
        const resolved = resolveSession(storage.repo, options.id)
        if (resolved.kind === 'none') {
          return failure(1, `找不到会话：${options.id}`)
        }
        if (resolved.kind === 'ambiguous') {
          return failure(
            1,
            `前缀 ${options.id} 匹配到 ${String(resolved.count)} 场会话，请提供更长的 ID`,
          )
        }

        const detail = resolved.detail
        if (options.json) {
          ctx.stdout(`${JSON.stringify(detail, null, 2)}\n`)
          return SUCCESS
        }

        const offset = localTimezoneOffsetMinutes()
        ctx.stdout(`会话 ${shortSessionId(detail.sessionId)}\n\n`)
        ctx.stdout(`${renderMeta(detail, offset)}\n\n`)
        ctx.stdout(`对话轮次\n`)
        ctx.stdout(`${renderTurns(detail, offset)}\n\n`)
        ctx.stdout(`工具统计\n`)
        ctx.stdout(`${renderTools(detail)}\n`)
        return SUCCESS
      } catch (error: unknown) {
        return runtimeFailure(ctx, error, '读取会话详情失败')
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
