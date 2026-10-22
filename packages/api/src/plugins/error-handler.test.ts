import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { AggregatedStats } from '../types.js'
import { ApiError, registerErrorHandlers } from './error-handler.js'
import { sendFailure } from '../routes/envelope.js'
import { FakeRepository } from '../test-support/fake-repository.js'
import { makeTestApp, readEnvelope } from '../test-support/test-app.js'

/** 一个仓储炸掉的 app：用来验证 500 分支不泄漏现场 */
class ExplodingRepository extends FakeRepository {
  override getOverview(): AggregatedStats {
    throw new Error('SQLITE 炸了：/Users/che1sy/secret/turnflare.db 无法打开')
  }
}

describe('ApiError', () => {
  it('带上状态码与人话', () => {
    const error = new ApiError(409, '已有扫描任务在进行中')

    expect(error.statusCode).toBe(409)
    expect(error.message).toBe('已有扫描任务在进行中')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('全局错误处理', () => {
  // 允许 undefined：afterEach 可能在 beforeEach 赋值前就跑
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('未预期异常返回 500 与固定话术', async () => {
    app = await makeTestApp({ repo: new ExplodingRepository() })

    const response = await app.inject({ method: 'GET', url: '/api/stats/overview' })

    expect(response.statusCode).toBe(500)
    const envelope = readEnvelope(response)
    expect(envelope.success).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error).toBe('服务器内部错误，请稍后重试')
  })

  it('500 响应不泄漏路径与堆栈', async () => {
    app = await makeTestApp({ repo: new ExplodingRepository() })

    const response = await app.inject({ method: 'GET', url: '/api/stats/overview' })

    expect(response.payload).not.toContain('/Users/che1sy')
    expect(response.payload).not.toContain('SQLITE')
    expect(response.payload).not.toContain('at ')
  })

  it('ApiError 按自带状态码返回', async () => {
    const probe = Fastify({ logger: false })
    void probe.register(async (instance) => {
      registerErrorHandlers(instance)
      instance.get('/boom', async () => {
        throw new ApiError(404, '未找到会话：abc')
      })
      instance.get('/fail', async (_request, reply) => {
        return sendFailure(reply, 418, '我是茶壶')
      })
    })
    await probe.ready()
    app = probe

    const notFound = await probe.inject({ method: 'GET', url: '/boom' })
    expect(notFound.statusCode).toBe(404)
    expect(readEnvelope(notFound).error).toBe('未找到会话：abc')

    const teapot = await probe.inject({ method: 'GET', url: '/fail' })
    expect(teapot.statusCode).toBe(418)
    expect(readEnvelope(teapot).success).toBe(false)
  })

  it('Fastify schema 校验失败转成中文 400', async () => {
    const probe = Fastify({ logger: false })
    void probe.register(async (instance) => {
      registerErrorHandlers(instance)
      instance.post(
        '/probe',
        {
          schema: {
            body: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
        async () => ({ ok: true }),
      )
    })
    await probe.ready()
    app = probe

    const response = await probe.inject({
      method: 'POST',
      url: '/probe',
      // 对象无法被 coerce 成字符串，才会真正触发校验失败
      payload: { name: { nested: true } },
    })

    expect(response.statusCode).toBe(400)
    const envelope = readEnvelope(response)
    expect(envelope.error).toContain('name')
    expect(envelope.success).toBe(false)
  })

  it('畸形 JSON 体给出针对性提示', async () => {
    const probe = Fastify({ logger: false })
    void probe.register(async (instance) => {
      registerErrorHandlers(instance)
      instance.post('/probe', async () => ({ ok: true }))
    })
    await probe.ready()
    app = probe

    const response = await probe.inject({
      method: 'POST',
      url: '/probe',
      payload: '{"name": ',
      headers: { 'content-type': 'application/json' },
    })

    expect(response.statusCode).toBe(400)
    expect(readEnvelope(response).error).toBe('请求体不是合法的 JSON')
  })
})
