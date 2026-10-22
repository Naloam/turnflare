/** Shared contracts; HTTP validation output remains local to the API. */
import type { SessionsQuery } from '@turnflare/contracts'

export type * from '@turnflare/contracts'

/**
 * zod 校验之后的会话查询：默认值已补齐，四个分页/排序字段必填。
 *
 * 与 SessionsQuery 分开是因为两者的"必填性"不同：仓储接口要宽容
 * （调用方可以只传 {}），而 HTTP 层的输出必须确定（响应 meta 里不能出现
 * undefined）。共用一个类型就得在其中一侧妥协。
 */
export interface ValidatedSessionsQuery extends SessionsQuery {
  readonly page: number
  readonly limit: number
  readonly sort: NonNullable<SessionsQuery['sort']>
  readonly order: NonNullable<SessionsQuery['order']>
}
