/**
 * 测试替身：内存版 SessionRepository。
 *
 * 为什么不 mock better-sqlite3：路由依赖的是仓储的**契约**（过滤、排序、
 * 分页、统计口径），拿真 SQLite 跑会让路由测试同时绑定 schema 细节；
 * 一个透明的内存实现则让"路由到底传了什么查询给仓储"变成可断言的。
 *
 * 说明：本文件参与测试类型检查，但不包含在生产构建中。
 */

import type { Session } from '@turnflare/core'
import type { FileStamp, SessionRepository, SessionTimeRange } from '../db/repository.js'
import type {
  AggregatedStats,
  CostBreakdown,
  ModelStats,
  ProjectStats,
  SessionDetail,
  SessionChain,
  SessionListItem,
  SessionsQuery,
  TimeBucket,
  TimelineQuery,
  TokenUsage,
  ToolStats,
  Turn,
} from '../types.js'

/** 取较早时刻；都没有则 undefined */
function earliestOf(left: string | null, right: string | null | undefined): string | null {
  if (left === null) return right ?? null
  if (right === undefined || right === null) return left
  return left.localeCompare(right) <= 0 ? left : right
}

/** 取较晚时刻；都没有则 undefined */
function latestOf(left: string | null, right: string | null | undefined): string | null {
  if (left === null) return right ?? null
  if (right === undefined || right === null) return left
  return left.localeCompare(right) >= 0 ? left : right
}

/** 从 turn 列表收集出现过的模型（去重、排除 null） */
function modelsOf(turns: readonly { model: string | null }[]): readonly string[] {
  return [
    ...new Set(turns.map((turn) => turn.model).filter((m): m is string => m !== null)),
  ].toSorted((a, b) => a.localeCompare(b))
}

/** 两个模型集合取并集，保持字典序 */
function mergeModelLists(left: readonly string[], right: readonly string[]): readonly string[] {
  return [...new Set([...left, ...right])].toSorted((a, b) => a.localeCompare(b))
}

import { makeAggregatedStats, makeCost, makeUsage } from './fixtures.js'

const EMPTY_USAGE: TokenUsage = makeUsage({
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  serverToolUse: 0,
})

const EMPTY_COST: CostBreakdown = makeCost({
  inputCost: 0,
  outputCost: 0,
  cacheWriteCost: 0,
  cacheReadCost: 0,
  totalCost: 0,
})

export interface FakeRepositoryOptions {
  readonly sessions?: readonly SessionDetail[]
  readonly stats?: Partial<AggregatedStats>
  readonly lastScanAt?: string | null
}

/** 仓储内部对一场会话的保存形态：详情 + 列表要用的轮次数 */
/**
 * 一场会话在内存里的形态。
 *
 * 全文件只此一份声明：曾经在 141 行附近还有一份逐字相同的副本，靠 TypeScript
 * 的接口合并才没报错。加字段时改这里就行，别处不需要同步。
 */
interface FakeSession {
  readonly detail: SessionDetail
  readonly turnCount: number
}

/** 详情 → 列表项；与仓储的 toSessionListItem 一致：去掉 turns 与解析错误数 */
function toListItem(session: FakeSession): SessionListItem {
  const detail = session.detail
  return {
    sessionId: detail.sessionId,
    projectSlug: detail.projectSlug,
    cwd: detail.cwd,
    gitBranch: detail.gitBranch,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    models: detail.models,
    turnCount: session.turnCount,
    usage: detail.usage,
    cost: detail.cost,
  }
}

/** 按 sort 字段比较两个列表项；同分时按 sessionId 升序，保证翻页顺序稳定 */
function compareBySort(
  left: SessionListItem,
  right: SessionListItem,
  sort: NonNullable<SessionsQuery['sort']>,
): number {
  switch (sort) {
    case 'cost':
      return left.cost.totalCost - right.cost.totalCost
    case 'tokens':
      return (
        left.usage.inputTokens +
        left.usage.cacheCreationTokens +
        left.usage.cacheReadTokens +
        left.usage.outputTokens -
        (right.usage.inputTokens +
          right.usage.cacheCreationTokens +
          right.usage.cacheReadTokens +
          right.usage.outputTokens)
      )
    case 'recent':
      return (left.startedAt ?? '').localeCompare(right.startedAt ?? '')
    case 'turns':
      return left.turnCount - right.turnCount
  }
}

function matchesFilters(item: SessionListItem, query: SessionsQuery): boolean {
  if (query.project !== undefined && item.projectSlug !== query.project) {
    return false
  }
  if (query.model !== undefined && !item.models.includes(query.model)) {
    return false
  }
  return true
}

/** 仓储内部对一场会话的保存形态：详情 + 列表要用的轮次数 */
export class FakeRepository implements SessionRepository {
  private readonly sessions = new Map<string, FakeSession>()
  private readonly stamps = new Map<string, FileStamp>()
  private readonly stats: AggregatedStats
  private lastScanAt: string | null

  constructor(options: FakeRepositoryOptions = {}) {
    for (const detail of options.sessions ?? []) {
      // 轮次数取自 turns 长度：夹具不提供第二个真源，避免两处对不上
      this.sessions.set(detail.sessionId, { detail, turnCount: detail.turns.length })
    }
    this.stats = makeAggregatedStats(options.stats ?? {})
    this.lastScanAt = options.lastScanAt ?? null
  }

  upsertSession(session: Session, stamp: FileStamp): void {
    this.stamps.set(stamp.filePath, stamp)
    const detail: SessionDetail = {
      sessionId: session.meta.sessionId,
      projectSlug: session.meta.projectSlug,
      cwd: session.meta.cwd,
      gitBranch: session.meta.gitBranch,
      startedAt: session.meta.startedAt,
      endedAt: session.meta.endedAt,
      models: [...session.meta.models],
      turns: [],
      chainCounts: { total: 0, main: 0, side: 0 },
      usage: EMPTY_USAGE,
      cost: EMPTY_COST,
      parseErrorCount: session.parseErrors.length,
    }
    this.sessions.set(session.meta.sessionId, { detail, turnCount: session.turns.length })
  }

  mergeSessionTurns(sessionId: string, turns: readonly Turn[], meta?: SessionTimeRange): void {
    const existing = this.sessions.get(sessionId)
    if (existing === undefined) {
      return
    }
    // 与真实仓储一致：按 uuid 合并而不是整体替换。一个 sessionId 对应多个
    // 文件（主会话 + subagent 记录），替换会让后扫的文件冲掉前面的 turn。
    const byUuid = new Map(existing.detail.turns.map((turn) => [turn.uuid, turn]))
    for (const turn of turns) {
      if (!byUuid.has(turn.uuid)) {
        byUuid.set(turn.uuid, turn)
      }
    }
    const merged = [...byUuid.values()].toSorted(
      (left, right) => left.lineNumber - right.lineNumber,
    )
    const startedAt =
      earliestOf(existing.detail.startedAt, meta?.startedAt) ?? existing.detail.startedAt
    const endedAt = latestOf(existing.detail.endedAt, meta?.endedAt) ?? existing.detail.endedAt

    this.sessions.set(sessionId, {
      detail: {
        ...existing.detail,
        turns: merged,
        startedAt,
        endedAt,
        models: mergeModelLists(existing.detail.models, modelsOf(merged)),
      },
      turnCount: merged.length,
    })
  }

  getSession(sessionId: string, chain: SessionChain = 'all', page = 1): SessionDetail | null {
    const detail = this.sessions.get(sessionId)?.detail
    if (detail === undefined) return null
    return {
      ...detail,
      turns: detail.turns
        .filter((turn) => chain === 'all' || turn.isSidechain === (chain === 'side'))
        .slice((page - 1) * 500, page * 500),
    }
  }

  listSessions(query: SessionsQuery): { items: SessionListItem[]; total: number } {
    // 与真实仓储一致：字段全部可选，缺省值在这里补。
    // 路由有 zod 兜底所以总是传全，但仓储是公开 API。
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const sort = query.sort ?? 'cost'
    const order = query.order ?? 'desc'

    const filtered = [...this.sessions.values()]
      .map((session) => toListItem(session))
      .filter((item) => matchesFilters(item, query))
    const sorted = filtered.toSorted((left, right) => {
      const primary = compareBySort(left, right, sort)
      const directed = order === 'asc' ? primary : -primary
      return directed === 0 ? left.sessionId.localeCompare(right.sessionId) : directed
    })
    const offset = Math.max(0, page - 1) * limit
    return { items: sorted.slice(offset, offset + limit), total: filtered.length }
  }

  getOverview(): AggregatedStats {
    return this.stats
  }

  getModelStats(): readonly ModelStats[] {
    return this.stats.byModel
  }

  getProjectStats(): readonly ProjectStats[] {
    return this.stats.byProject
  }

  /**
   * 时间线。
   *
   * 只模拟 since / until：桶是全局口径、不带项目信息，project 过滤在 SQL 层
   * 由 JOIN sessions 完成，这里无从模拟，路由测试也不该依赖它。
   */
  getTimeline(query: TimelineQuery): readonly TimeBucket[] {
    const buckets = query.granularity === 'hour' ? this.stats.byHour : this.stats.byDay
    return buckets.filter((bucket) => {
      if (query.since !== undefined && bucket.bucket < query.since) {
        return false
      }
      if (query.until !== undefined && bucket.bucket >= query.until) {
        return false
      }
      return true
    })
  }

  getToolStats(): readonly ToolStats[] {
    return this.stats.toolUsage
  }

  countSessions(): number {
    return this.sessions.size
  }

  getLastScanAt(): string | null {
    return this.lastScanAt
  }

  getFileStamps(): readonly FileStamp[] {
    return [...this.stamps.values()]
  }

  clearAll(): void {
    this.sessions.clear()
    this.stamps.clear()
    this.lastScanAt = null
  }
}
