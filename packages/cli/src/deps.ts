/**
 * 默认依赖装配。
 *
 * 这是整个 CLI 唯一"碰真实世界"的地方：真数据库、真文件、真端口、真信号。
 * 命令实现拿到的 `CliDeps` 是这份装配的替身，测试因此可以在内存里跑完整流程。
 */
import { writeFileSync } from 'node:fs'
import type { EventEmitter } from 'node:events'
import {
  openDatabase,
  createRepository,
  loadConfig,
  collectReportData,
  renderReport,
  buildApp,
} from '@turnflare/api'
import type { ScanDeps } from './commands/scan.js'
import type { StatsDeps } from './commands/stats.js'
import type { SessionsDeps } from './commands/sessions.js'
import type { SessionDeps } from './commands/session.js'
import type { ReportDeps } from './commands/report.js'
import type { ServeDeps } from './commands/serve.js'
import type { ListenableApp, ServerHandle } from './commands/serve.js'
import type { AppConfig } from './api-types.js'
import { createCliProgress, createSilentProgress } from './progress.js'
import { formatListenUrl } from './format.js'

/** 七个命令需要的依赖之和 */
export interface CliDeps
  extends ScanDeps, StatsDeps, SessionsDeps, SessionDeps, ReportDeps, ServeDeps {}

/** 默认监听地址；与 serve 命令展示的是同一个函数，避免两处口径漂移 */
export function listenWithFastify(app: ListenableApp, config: AppConfig): Promise<ServerHandle> {
  return app.listen({ port: config.port, host: config.host }).then(() => ({
    url: formatListenUrl(config.host, config.port),
    close: () => app.close().then(() => undefined),
  }))
}

/** 写报表文件；单独暴露是为了让测试用临时目录验证，而不是 mock 掉 fs */
export function writeFileWithFs(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf8')
}

/**
 * 等到 SIGINT / SIGTERM 再 resolve。
 *
 * `target` 可注入：测试传一个假 EventEmitter，不必真的给测试进程发信号。
 * `once` 保证不会重复触发——重复触发的等待器会让第二次 Ctrl+C 失效。
 */
export function createShutdownWaiter(target: EventEmitter = process): () => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      const onSignal = (): void => {
        target.off('SIGINT', onSignal)
        target.off('SIGTERM', onSignal)
        resolve()
      }
      target.once('SIGINT', onSignal)
      target.once('SIGTERM', onSignal)
    })
}

/** 生产环境装配 */
export function createDefaultDeps(): CliDeps {
  return {
    loadConfig,
    openDatabase,
    createRepository,
    // 进度条写 stderr：stdout 要留给结果与 --json 载荷
    createProgress: ({ enabled }) =>
      enabled ? createCliProgress(process.stderr) : createSilentProgress(),
    collectReportData,
    renderReport,
    writeFile: writeFileWithFs,
    buildApp,
    listen: listenWithFastify,
    awaitShutdown: createShutdownWaiter(),
  }
}
