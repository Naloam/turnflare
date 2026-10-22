/**
 * @turnflare/api —— 服务装配与启动入口。
 *
 * `buildApp` 是纯装配：不碰真实数据库文件、不监听端口，注入 repo / config /
 * scanner 工厂就能跑，测试因此可以用 app.inject 打整条 HTTP 栈而不起端口。
 * `start` 才是真正干活的入口：读配置、建库、装配、监听、挂优雅关闭。
 */

import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './config.js'
import { loadConfig } from './config.js'
import { openDatabase } from './db/index.js'
import { createRepository, type SessionRepository } from './db/repository.js'
import { registerErrorHandlers } from './plugins/error-handler.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerReportRoutes } from './routes/report.js'
import {
  registerScanRoutes,
  createDefaultScannerFactory,
  type ScannerFactory,
} from './routes/scan.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { registerStatsRoutes } from './routes/stats.js'

/** 请求体上限：扫描入参只是几个字符串，1MB 绰绰有余 */
const MAX_BODY_BYTES = 1024 * 1024

/** 优雅关闭要接住的信号 */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** 启动失败时的退出码 */
const EXIT_FAILURE = 1

export interface BuildAppDeps {
  readonly repo: SessionRepository
  readonly config: AppConfig
  /** 扫描器工厂；测试注入假实现，避免真的扫磁盘 */
  readonly scannerFactory?: ScannerFactory
  /** Built dashboard directory; omitted when using the sibling web package. */
  readonly webRoot?: string
}

/** 装配一个 Fastify 实例；同步返回，插件与路由在 ready/listen 时生效 */
export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const { repo, config } = deps
  const scannerFactory = deps.scannerFactory ?? createDefaultScannerFactory

  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: MAX_BODY_BYTES,
  })

  // 全部注册塞进同一个插件：CORS 的钩子才能覆盖后面这些路由，
  // 错误处理器也才对它们生效。
  void app.register(async (instance) => {
    await instance.register(cors, {
      origin: [...config.corsOrigins],
      // 不带凭证：本服务不需要 cookie，跨域也就不该允许携带凭证
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
    })

    registerErrorHandlers(instance)
    registerHealthRoutes(instance, { repo, config })
    registerSessionRoutes(instance, { repo })
    registerStatsRoutes(instance, { repo })
    registerScanRoutes(instance, {
      config,
      scanner: scannerFactory({ repo, config }),
      logger: instance.log,
    })
    registerReportRoutes(instance, { repo })

    const webRoot = deps.webRoot ?? fileURLToPath(new URL('../../web/dist/', import.meta.url))
    if (existsSync(path.join(webRoot, 'index.html'))) {
      // Register actual files only: unknown /api paths must keep their JSON 404.
      await instance.register(fastifyStatic, { root: webRoot, wildcard: false, dotfiles: 'deny' })
    }
  })

  return app
}

/** 读配置、建库、装配、监听；返回实例供调用方在测试里直接 inject */
export async function start(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const opened = openDatabase(config.dbPath)
  const repo = createRepository(opened.db)
  const app = buildApp({ repo, config })

  const onSignal = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, '收到关闭信号，正在优雅退出')
    void app.close().catch((error: unknown) => {
      app.log.error({ err: error }, '关闭过程出错')
      process.exitCode = EXIT_FAILURE
    })
  }
  // onClose runs after pending requests finish, for signals and programmatic closes.
  app.addHook('onClose', () => {
    for (const signal of SHUTDOWN_SIGNALS) process.off(signal, onSignal)
    opened.db.close()
    return Promise.resolve()
  })
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, onSignal)
  }

  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (error: unknown) {
    // 端口占用这类启动失败必须留痕：只抛异常的话进程退出原因就没了
    app.log.error({ err: error, port: config.port, host: config.host }, '服务启动失败')
    await app.close()
    throw error
  }

  app.log.info(
    { port: config.port, host: config.host, dbPath: config.dbPath },
    'Turnflare API 已启动',
  )
  return app
}
