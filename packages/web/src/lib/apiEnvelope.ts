import type { ApiResponse } from '../types/api'

/**
 * 把 `unknown` 收窄成「字符串键的普通对象」，是所有边界校验的第一步。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * API 响应包络的类型守卫。
 *
 * 为什么需要它：`Response.json()` 的返回值是 `unknown`，而项目规范禁止 `as` 强转。
 * 类型谓词是唯一能在不写 `as` 的前提下，把 `unknown` 收窄成带泛型的 `ApiResponse<T>` 的手段。
 *
 * 为什么必须校验 `data` 键存在：`ApiResponse<T>` 里 `data` 是必填字段（`T | null`），
 * 而服务端唯一的包络出口（packages/api/src/routes/envelope.ts 的 sendData / sendList /
 * sendFailure）每一条都写 `data`。所以缺 `data` 的载荷一定是坏响应——只校验 `success`
 * 是布尔值时，`{"success":true}` 会被当成合法包络放行，`undefined` 顺势流进
 * `setData`，一直到渲染层读 `data.cost` 才炸。在这里拒掉，调用方拿到的是
 * 一个已经能渲染的「响应解析失败」错误态。
 *
 * 注意：这里只校验「形状像包络」，不校验 data 的深层结构——深层结构由页面按需兜底
 * （字段缺失时显示 "-" 而不是崩溃）。
 */
export function isApiEnvelope<T>(payload: unknown): payload is ApiResponse<T> {
  return isRecord(payload) && typeof payload.success === 'boolean' && 'data' in payload
}

/** 服务端返回 success=false 但没给 error 字段时的兜底文案 */
export const UNKNOWN_API_ERROR = '请求失败：服务端未返回错误信息'

/** 网络层失败（断网、DNS、CORS、连接被拒）时展示的文案 */
export const NETWORK_ERROR = '网络请求失败：无法连接到 API 服务'

/** 响应体不是合法 JSON 时展示的文案 */
export const MALFORMED_RESPONSE_ERROR = '响应解析失败：服务端返回了非 JSON 内容'

/** HTTP 状态码非 2xx 时展示的文案 */
export function httpStatusError(status: number): string {
  return `请求失败（HTTP ${status}）`
}
