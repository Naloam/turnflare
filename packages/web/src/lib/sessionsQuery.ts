/**
 * 会话列表查询参数的构造与类型。
 *
 * 放在 lib 而不是组件里：SessionFilters（UI）和 SessionsPage（取数）都需要同一份定义，
 * 放在组件里会让 lib 反向依赖 components。
 */

/** 排序字段，与 API 契约 SessionsQuery.sort 对齐 */
export type SessionSortKey = 'cost' | 'tokens' | 'recent' | 'turns'

/** 排序方向 */
export type SessionOrder = 'asc' | 'desc'

export const SESSION_SORT_OPTIONS: readonly { value: SessionSortKey; label: string }[] = [
  { value: 'cost', label: '按成本' },
  { value: 'tokens', label: '按 Token' },
  { value: 'recent', label: '按时间' },
  { value: 'turns', label: '按 Turn 数' },
]

/** 每页固定条数。显式传参，避免前后端默认值不一致导致分页错位 */
export const SESSIONS_PAGE_SIZE = 20

interface SessionsQueryInput {
  readonly page: number
  readonly project: string | null
  readonly sort: SessionSortKey
  readonly order: SessionOrder
  readonly limit?: number
}

/**
 * 构造 `/sessions` 的查询串（含前导 `?`）。
 *
 * 用 URLSearchParams 而不是字符串拼接：项目 slug 可能含 `/`、空格等字符，
 * 手写拼接会出现 `?project=a/b` 被路由当成路径段的 bug。
 */
export function buildSessionsQuery(input: SessionsQueryInput): string {
  const search = new URLSearchParams()
  search.set('limit', String(input.limit ?? SESSIONS_PAGE_SIZE))
  search.set('page', String(input.page))
  search.set('sort', input.sort)
  search.set('order', input.order)
  if (input.project !== null) {
    search.set('project', input.project)
  }
  return `?${search.toString()}`
}
