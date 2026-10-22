/**
 * `turnflare serve` —— 启动 API 服务。
 *
 * 装配走 api 包的 `buildApp` + `listen`，不碰 `start()`：`start()` 自己从
 * `process.env` 读端口，那样 `--port` 就失效了（或者得去改进程环境变量）。
 * 显式装配还能让测试注入假的 listen / awaitShutdown，不必真的占端口。
 *
 * 优雅退出：`awaitShutdown` 等到 SIGINT/SIGTERM 再关闭服务，
 * 于是 Ctrl+C 不会把正在写的 SQLite 事务硬生生掐断。
 */
import type { AppConfig, BuildAppFn } from '../api-types.js'
import { SUCCESS } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { ServeOptions } from '../options.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure } from './shared.js'

/** 服务句柄：CLI 只需要"地址"和"关闭"两件事 */
export interface ServerHandle {
  readonly url: string
  readonly close: () => Promise<void>
}

/**
 * Fastify 实例的最小形状。
 *
 * 声明成结构接口而不是直接引用 `FastifyInstance`：CLI 只用 listen / close 两个
 * 方法，把整个 Fastify 类型拖进来会让测试替身无法满足它（71 个成员）。
 */
export interface ListenableApp {
  listen: (options: { readonly port: number; readonly host: string }) => Promise<unknown>
  close: () => Promise<unknown>
}

export interface ServeDeps extends StorageDeps {
  readonly buildApp: BuildAppFn
  /** 监听端口；默认实现调用 Fastify 的 listen */
  readonly listen: (app: ListenableApp, config: AppConfig) => Promise<ServerHandle>
  /** 等待退出信号；默认实现监听 SIGINT / SIGTERM */
  readonly awaitShutdown: () => Promise<void>
}

/** `--port` 缺省时沿用 api 配置（`PORT` 环境变量或 8787） */
function resolvePort(options: ServeOptions, config: AppConfig): number {
  return options.port ?? config.port
}

export function createServeCommand(deps: ServeDeps): Command<ServeOptions> {
  return {
    name: 'serve',
    description: '启动 API 服务',
    usage: 'turnflare serve [--port N]',
    run: async (ctx: CliContext, options: ServeOptions): Promise<CommandResult> => {
      const storage = openStorageFromEnv(ctx.env, deps)
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      try {
        // 端口优先级：命令行 > PORT 环境变量 > 默认值
        const config: AppConfig = { ...storage.config, port: resolvePort(options, storage.config) }
        const app = deps.buildApp({ repo: storage.repo, config })
        const server = await deps.listen(app, config)

        if (options.json) {
          ctx.stdout(
            `${JSON.stringify({ url: server.url, dataRoot: config.dataRoot, dbPath: storage.dbPath }, null, 2)}\n`,
          )
        } else {
          ctx.stdout(`Turnflare API 已启动\n`)
          ctx.stdout(`  监听地址   ${server.url}\n`)
          ctx.stdout(`  数据根目录 ${config.dataRoot}\n`)
          ctx.stdout(`  数据库     ${storage.dbPath}\n`)
          ctx.stderr('按 Ctrl+C 停止服务\n')
        }

        await deps.awaitShutdown()
        await server.close()
        ctx.stderr('服务已停止\n')
        return SUCCESS
      } catch (error: unknown) {
        return runtimeFailure(ctx, error, '启动服务失败')
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
