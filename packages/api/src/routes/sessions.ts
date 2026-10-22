/**
 * @turnflare/api —— 会话列表与详情路由。
 *
 * 两处需要说明的设计：
 *   1. **前缀定位**：docs/API.md 允许传会话 id 前几位。仓储只支持精确查
 *      (`session_id = ?`)，所以这里先试精确命中，未命中再翻页做前缀匹配。
 *      翻页有上限（MAX_ID_PAGES × ID_PAGE_SIZE 条），避免一个恶意前缀把
 *      整表拖进内存。
 *   2. **分页 meta 必须与过滤条件一致**：total 由仓储按同一份查询算出来，
 *      路由不做二次过滤，否则会出现"列表 2 条、total 写 50"。
 */

import type { FastifyInstance } from 'fastify'
import type { SessionRepository } from '../db/repository.js'
import { ApiError } from '../plugins/error-handler.js'
import { parseSessionChain, parseSessionId, parseSessionsQuery } from '../schemas/index.js'
import { sendData, sendList } from './envelope.js'

export interface SessionRouteDeps {
  readonly repo: SessionRepository
}

/** 前缀匹配每页拉多少条 */
const ID_PAGE_SIZE = 200

/** 前缀匹配最多翻几页：10 × 200 = 2000 条，覆盖本地使用的全部量级 */
const MAX_ID_PAGES = 10

/** 前缀匹配的结果：要么给出完整 id，要么给出"为什么不行" */
type SessionResolution =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly status: number; readonly error: string }

function toResolution(rawId: string, matches: readonly string[]): SessionResolution {
  const [firstMatch, ...restMatches] = matches
  if (firstMatch === undefined) {
    return { ok: false, status: 404, error: `未找到会话：${rawId}` }
  }
  if (restMatches.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `会话 id 前缀匹配到 ${matches.length} 个会话，请提供更完整的 id`,
    }
  }
  return { ok: true, sessionId: firstMatch }
}

/** 翻页收集以 rawId 开头的会话 id；翻到尾就停，不做无意义的请求 */
function collectPrefixMatches(repo: SessionRepository, rawId: string): readonly string[] {
  const matches: string[] = []
  for (let page = 1; page <= MAX_ID_PAGES; page += 1) {
    const { items, total } = repo.listSessions({
      page,
      limit: ID_PAGE_SIZE,
      sort: 'recent',
      order: 'desc',
    })
    for (const item of items) {
      if (item.sessionId.startsWith(rawId)) {
        matches.push(item.sessionId)
      }
    }
    if (page * ID_PAGE_SIZE >= total) {
      break
    }
  }
  return matches
}

function resolveSessionId(repo: SessionRepository, rawId: string): SessionResolution {
  // 完整 id 是常见路径（前端详情页就是这么调的），先用一次精确查询挡掉，
  // 命中就不必翻页。
  if (repo.getSession(rawId) !== null) {
    return { ok: true, sessionId: rawId }
  }
  return toResolution(rawId, collectPrefixMatches(repo, rawId))
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  app.get('/api/sessions', async (request, reply) => {
    const parsed = parseSessionsQuery(request.query)
    if (!parsed.ok) {
      throw new ApiError(400, parsed.error)
    }
    const { items, total } = deps.repo.listSessions(parsed.value)
    return sendList(reply, items, {
      total,
      page: parsed.value.page,
      limit: parsed.value.limit,
    })
  })

  app.get('/api/sessions/:id', async (request, reply) => {
    const chain = parseSessionChain(request.query)
    if (!chain.ok) {
      throw new ApiError(400, chain.error)
    }
    const parsedId = parseSessionId(request.params)
    if (!parsedId.ok) {
      throw new ApiError(400, parsedId.error)
    }
    const resolved = resolveSessionId(deps.repo, parsedId.value)
    if (!resolved.ok) {
      throw new ApiError(resolved.status, resolved.error)
    }
    const detail = deps.repo.getSession(resolved.sessionId, chain.value.chain, chain.value.page)
    if (detail === null) {
      // 前缀匹配与详情查询之间数据理论上不会消失；真发生了按 404 收尾。
      throw new ApiError(404, `未找到会话：${parsedId.value}`)
    }
    return sendData(reply, detail)
  })
}
