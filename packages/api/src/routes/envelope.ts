/**
 * @turnflare/api —— 统一响应包络的构造入口。
 *
 * 每个成功响应都必须经过这里的 `sendData` / `sendList`，失败响应经过
 * `sendFailure`：包络形状只有一份实现，不会出现某个路由漏掉 `error: null`
 * 或者某个列表路由忘了带 `meta` 的情况。
 */

import type { FastifyReply } from 'fastify'
import type { ApiMeta, ApiResponse } from '../types.js'

/** 成功载荷；`data` 允许是只读数组，包络本身不关心元素是否可写 */
export function sendData<T>(reply: FastifyReply, data: T): FastifyReply {
  const envelope: ApiResponse<T> = { success: true, data, error: null }
  return reply.send(envelope)
}

/** 分页元信息；`generatedAt` 在这里统一打时间戳，路由不必各自 new Date() */
export function sendList<T>(
  reply: FastifyReply,
  items: readonly T[],
  page: Omit<ApiMeta, 'generatedAt'>,
): FastifyReply {
  const envelope: ApiResponse<readonly T[]> = {
    success: true,
    data: items,
    error: null,
    meta: { ...page, generatedAt: new Date().toISOString() },
  }
  return reply.send(envelope)
}

/** 失败响应：只带中文可读信息，详情由 error-handler 写进服务端日志 */
export function sendFailure(
  reply: FastifyReply,
  statusCode: number,
  message: string,
): FastifyReply {
  const envelope: ApiResponse<never> = { success: false, data: null, error: message }
  return reply.code(statusCode).send(envelope)
}
