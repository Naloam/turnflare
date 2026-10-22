/**
 * @turnflare/api —— 全局错误处理。
 *
 * 一条铁律：**客户端只看到中文可读的一句话，现场只进服务端日志**。
 * 异常对象里可能裹着绝对路径、SQL 片段、系统目录结构，直接回给调用方等于
 * 把部署环境的结构送出去；而一句"服务器内部错误"对排障毫无帮助。所以两边
 * 分工明确——日志里带完整 `err`，响应里只有 `error` 字段那一句。
 */

import type { FastifyError, FastifyInstance } from 'fastify'
import { sendFailure } from '../routes/envelope.js'

/** 未预期错误的对外话术；具体原因只进日志 */
const INTERNAL_ERROR_MESSAGE = '服务器内部错误，请稍后重试'

/** 错误信息里最多拼几个字段，避免刷屏 */
const MAX_REPORTED_ISSUES = 3

const HTTP_STATUS_BAD_REQUEST = 400
const HTTP_STATUS_NOT_FOUND = 404
const HTTP_STATUS_SERVER_ERROR = 500

/** Fastify 对畸形 JSON 体的错误码 */
const INVALID_JSON_BODY_CODE = 'FST_ERR_CTP_INVALID_JSON_BODY'

/**
 * 带 HTTP 状态码的业务错误。
 *
 * 路由层用它在任何位置表达"这次请求为什么不行"：404 找不到会话、
 * 409 已有扫描任务、400 参数不对。异常穿过 Fastify 后由下面的
 * error handler 统一翻译成包络，路由本身不需要 try/catch。
 */
export class ApiError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
  }
}

/** 从异常里读状态码；框架异常一定带，普通 Error 一律按 500 算 */
function readStatusCode(error: FastifyError): number {
  const raw: unknown = error.statusCode
  return typeof raw === 'number' && raw >= HTTP_STATUS_BAD_REQUEST ? raw : HTTP_STATUS_SERVER_ERROR
}

/** unknown → 字典；驱动与框架回包都要先过这一道才能读字段 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 Fastify 自带 schema 校验的 issue 列表翻成中文 */
function describeValidationIssues(error: FastifyError): string | null {
  const raw: unknown = error.validation
  if (!Array.isArray(raw)) {
    return null
  }
  const issues: readonly unknown[] = raw
  const parts = issues.flatMap((issue) => {
    if (!isRecord(issue)) {
      return []
    }
    const field =
      typeof issue.instancePath === 'string' ? issue.instancePath.replace(/^\//, '') : ''
    const reason = typeof issue.message === 'string' ? issue.message : '取值不合法'
    if (field.length === 0) {
      return [`请求参数校验不通过：${reason}`]
    }
    return [`参数 ${field} 校验不通过：${reason}`]
  })
  if (parts.length === 0) {
    return null
  }
  return parts.slice(0, MAX_REPORTED_ISSUES).join('；')
}

/** 4xx 的对外话术；框架自己产生的错误也尽量说清是哪一类 */
function describeClientError(error: FastifyError): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error.code === INVALID_JSON_BODY_CODE) {
    return '请求体不是合法的 JSON'
  }
  return describeValidationIssues(error) ?? '请求参数不合法'
}

/** 404 只回方法与路径，不带查询串：查询串是调用方原样输入的内容 */
function describePath(request: { readonly url: string }): string {
  const [pathname = request.url] = request.url.split('?')
  return pathname
}

/**
 * 注册全局错误处理与 404 处理。
 *
 * 必须在任何路由之前注册，且与路由同处一个封装上下文——注册在插件里，
 * 保证后面 addHook / addRoute 出来的路由都受它管辖。
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ method: request.method, url: request.url }, '接口不存在')
    return sendFailure(
      reply,
      HTTP_STATUS_NOT_FOUND,
      `接口不存在：${request.method} ${describePath(request)}`,
    )
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = readStatusCode(error)

    if (statusCode >= HTTP_STATUS_SERVER_ERROR) {
      request.log.error({ err: error }, '未预期的服务器错误')
      return sendFailure(reply, statusCode, INTERNAL_ERROR_MESSAGE)
    }

    if (error instanceof ApiError) {
      request.log.warn({ err: error }, '请求被拒绝')
    } else {
      request.log.warn({ err: error }, '请求参数不合法')
    }
    return sendFailure(reply, statusCode, describeClientError(error))
  })
}
