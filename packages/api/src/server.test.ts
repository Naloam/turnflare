import { createServer } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp } from './test-support/test-app.js'
import { start } from './server.js'

/**
 * printRoutes 渲染出来的行。
 *
 * 它用缩进表达父子关系（`/api/sessions` 下挂 `/:id`），所以这里按渲染结果
 * 逐行盯，漏注册或路径写错都会立刻红。
 */
const EXPECTED_ROUTE_LINES: readonly string[] = [
  '/api/health (GET, HEAD)',
  '/api/sessions (GET, HEAD)',
  '/:id (GET, HEAD)',
  '/api/stats/overview (GET, HEAD)',
  '/api/stats/models (GET, HEAD)',
  '/api/stats/projects (GET, HEAD)',
  '/api/stats/tools (GET, HEAD)',
  '/api/stats/timeline (GET, HEAD)',
  '/api/scan (POST)',
  '/:jobId (GET, HEAD)',
  '/api/report (GET, HEAD)',
]

const ALLOWED_ORIGIN = 'http://localhost:5173'

describe('路由表', () => {
  // 允许 undefined：afterEach 可能在 beforeEach 赋值前就跑
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('十一条路由全部注册', async () => {
    app = await makeTestApp()

    const printed = app.printRoutes({ commonPrefix: false })

    for (const line of EXPECTED_ROUTE_LINES) {
      expect(printed).toContain(line)
    }
    // CORS 的预检通配路由：没有它浏览器跨域 POST /api/scan 会先失败
    expect(printed).toContain('* (OPTIONS)')
  })
})

describe('CORS', () => {
  // 允许 undefined：afterEach 可能在 beforeEach 赋值前就跑
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('白名单内的源拿到 CORS 头，且不带凭证', async () => {
    app = await makeTestApp({ config: { corsOrigins: [ALLOWED_ORIGIN] } })

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: ALLOWED_ORIGIN },
    })

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
    // 本服务不认 cookie，也就不该告诉浏览器可以带凭证
    expect(response.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('白名单外的源拿不到 CORS 头', async () => {
    app = await makeTestApp({ config: { corsOrigins: [ALLOWED_ORIGIN] } })

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://evil.example' },
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('预检请求返回 204 与允许的方法', async () => {
    app = await makeTestApp({ config: { corsOrigins: [ALLOWED_ORIGIN] } })

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/scan',
      headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'POST' },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-methods']).toContain('POST')
  })
})

/**
 * `start()` 的真身测试。
 *
 * `buildApp` 已经被 makeTestApp 全覆盖，但 start / shutdown / 启动失败路径都在
 * buildApp 之外，长期被 vitest.config.ts 整文件排除在覆盖率外。这两条把它拉进来：
 * 真端口 + `:memory:` 库启动一次，端口被占用时再启动一次。
 *
 * 剩下没覆盖的是文件末尾的"被直接执行才启动"守卫（isDirectRun /
 * toStartupMessage），见 vitest.config.ts 里为什么不补。
 */
describe('start()', () => {
  /** start() 读的是 process.env，跑完必须还原，别让配置漏给同文件后续用例 */
  const ENV_KEYS = ['PORT', 'HOST', 'TURNFLARE_DB'] as const
  const savedEnv = new Map<string, string | undefined>()

  let app: FastifyInstance | undefined

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key])
    }
  })

  afterEach(async () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    savedEnv.clear()
    if (app !== undefined) {
      await app.close()
      app = undefined
    }
  })

  /** 让操作系统分一个没人用的端口；用完立刻还回去，端口号仍然可用 */
  function reservePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        probe.close(() => {
          if (address === null || typeof address === 'string') {
            reject(new Error('拿不到临时端口'))
            return
          }
          resolve(address.port)
        })
      })
    })
  }

  it('读配置、建库、监听，然后能正常应答', async () => {
    // Arrange
    const port = await reservePort()
    process.env['PORT'] = String(port)
    process.env['HOST'] = '127.0.0.1'
    // :memory: 让测试既不碰用户真实的 ~/.turnflare，也不留临时文件
    process.env['TURNFLARE_DB'] = ':memory:'

    // Act
    app = await start()

    // Assert：inject 走的是完整 HTTP 栈，证明 listen 真的成功了
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
  })

  it('closing the app releases its signal listeners', async () => {
    const counts = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))
    process.env['PORT'] = String(await reservePort())
    process.env['HOST'] = '127.0.0.1'
    process.env['TURNFLARE_DB'] = ':memory:'
    app = await start()
    await app.close()
    expect(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))).toEqual(counts)
  })

  it('端口被占用时留痕并重抛，而不是静默退成未监听状态', async () => {
    // Arrange：用一个常驻的裸 socket 占住端口，比"先 start 再 start"更稳——
    // 后者要在两次 start 之间保证端口不被别人抢走
    const port = await reservePort()
    const squatter = createServer()
    await new Promise<void>((resolve) => {
      squatter.listen(port, '127.0.0.1', resolve)
    })
    process.env['PORT'] = String(port)
    process.env['HOST'] = '127.0.0.1'
    process.env['TURNFLARE_DB'] = ':memory:'

    try {
      // Act & Assert：失败路径必须把错误抛出去，调用方才知道进程为什么起了没起来
      const counts = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))
      await expect(start()).rejects.toThrow()
      expect(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal))).toEqual(counts)
    } finally {
      await new Promise<void>((resolve) => {
        squatter.close(() => resolve())
      })
    }
  })
})
