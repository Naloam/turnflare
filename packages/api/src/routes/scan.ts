/**
 * @turnflare/api —— 扫描任务路由。
 *
 * 异步模型：POST 立即返回任务句柄，真正的工作在后台跑。因此本文件要同时解决
 * 三件事——
 *   1. **并发唯一**：同一时刻只允许一个扫描任务，重复提交 409；
 *   2. **失败落库**：扫描抛出的任何异常都必须收进 `job.error`，绝不能变成
 *      unhandledRejection 把整个进程带走（Node 默认行为是直接退出）；
 *   3. **不泄漏路径**：失败话术固定为一句中文，扫描异常里的绝对路径只进日志。
 *
 * 任务状态放在进程内的 Map 里，不落库：重启后旧任务句柄自然失效，
 * 这比"库里留着永远跑不完的任务"更诚实。
 */

import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import type { SessionRepository } from '../db/repository.js'
import { Scanner } from '../scanner/index.js'
import type { ScanInput, ScanOutcome } from '../scanner/index.js'
import { ApiError } from '../plugins/error-handler.js'
import { parseJobId, parseScanBody } from '../schemas/index.js'
import type { ScanJob, ScanRequest } from '../types.js'
import { sendData } from './envelope.js'

/** 扫描失败时的对外话术；异常详情只进日志 */
const SCAN_FAILED_MESSAGE = '扫描任务失败，请查看服务端日志'

/** 进度回调签名；与 Scanner 的 onProgress 一致 */
export interface ScanProgressHooks {
  readonly onProgress?: (done: number, total: number, filePath: string) => void
}

/** 路由只依赖"能扫"这件事，不关心背后是 Scanner 还是测试替身 */
export interface ScannerLike {
  scan(input: ScanInput, hooks?: ScanProgressHooks): Promise<ScanOutcome>
}

export type ScannerFactory = (deps: {
  readonly repo: SessionRepository
  readonly config: AppConfig
}) => ScannerLike

/** 默认工厂：把数据层与配置交给 Scanner */
export const createDefaultScannerFactory: ScannerFactory = (deps) => ({
  scan(input, hooks) {
    const scanner = new Scanner({
      repo: deps.repo,
      config: deps.config,
      ...(hooks?.onProgress === undefined ? {} : { onProgress: hooks.onProgress }),
    })
    return scanner.scan(input)
  },
})

/** 任务推进接口；每个方法都把内部快照换成新对象，外部拿到的 job 永远不变 */
export interface ScanJobHandle {
  readonly job: ScanJob
  markRunning(): void
  updateProgress(done: number, total: number): void
  markDone(outcome: ScanOutcome): void
  markFailed(): void
}

class ScanJobEntry implements ScanJobHandle {
  private snapshot: ScanJob

  constructor(jobId: string) {
    this.snapshot = {
      jobId,
      status: 'queued',
      totalFiles: 0,
      processedFiles: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    }
  }

  get job(): ScanJob {
    return this.snapshot
  }

  markRunning(): void {
    this.snapshot = { ...this.snapshot, status: 'running' }
  }

  updateProgress(done: number, total: number): void {
    this.snapshot = { ...this.snapshot, totalFiles: total, processedFiles: done }
  }

  markDone(outcome: ScanOutcome): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'done',
      totalFiles: outcome.totalFiles,
      // 处理数必须覆盖全部四类结局，只算 scanned 会让进度条永远走不到 100%
      processedFiles:
        outcome.scannedFiles + outcome.skippedFiles + outcome.skippedEmpty + outcome.failedFiles,
      finishedAt: new Date().toISOString(),
    }
  }

  markFailed(): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: SCAN_FAILED_MESSAGE,
    }
  }
}

export interface ScanJobStore {
  /** 当前进行中的任务；没有则 null */
  readonly active: () => ScanJob | null
  readonly get: (jobId: string) => ScanJob | null
  /** 入队并立即开跑；已有任务在进行中时返回 null */
  readonly enqueue: (run: (handle: ScanJobHandle) => Promise<void>) => ScanJob | null
}

export interface ScanJobStoreOptions {
  /** 兜底 catch 触发时通知调用方：这类异常说明 run 自身写错了，必须留痕 */
  readonly onUnexpectedError?: (error: unknown) => void
}

/** 建一个进程内任务表；每个 buildApp 一份，测试之间天然隔离 */
export function createScanJobStore(options: ScanJobStoreOptions = {}): ScanJobStore {
  const entries = new Map<string, ScanJobEntry>()

  const findActive = (): ScanJobEntry | undefined =>
    [...entries.values()].find(
      (entry) => entry.job.status === 'queued' || entry.job.status === 'running',
    )

  return {
    active: () => findActive()?.job ?? null,
    get: (jobId) => entries.get(jobId)?.job ?? null,
    enqueue(run) {
      if (findActive() !== undefined) {
        return null
      }
      // Keep live indexing from growing an unbounded in-memory job history.
      while (entries.size >= 100) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
      const entry = new ScanJobEntry(randomUUID())
      entries.set(entry.job.jobId, entry)
      // 先取快照再启动：run() 会同步推进到 running，而 docs/API.md 要求
      // POST 的响应里 status 是 queued——返回提交那一刻的状态才对得上。
      const submitted = entry.job
      // 关键：显式 void + catch。后台任务的 rejection 没人接就会被 Node
      // 升级成 unhandledRejection，默认直接杀进程——一次扫描失败不该让服务
      // 陪葬，所以在这里兜住并落进 job.error。
      void run(entry).catch((error: unknown) => {
        entry.markFailed()
        options.onUnexpectedError?.(error)
      })
      return submitted
    },
  }
}

/** 请求体 → 扫描入参；rootDir 缺省落到配置的数据根目录 */
function toScanInput(request: ScanRequest, config: AppConfig): ScanInput {
  return {
    rootDir: request.rootDir ?? config.dataRoot,
    force: request.force === true,
    ...(request.projectSlugs === undefined ? {} : { projectSlugs: request.projectSlugs }),
    ...(request.since === undefined ? {} : { since: request.since }),
  }
}

async function runScan(
  scanner: ScannerLike,
  handle: ScanJobHandle,
  input: ScanInput,
  logger: FastifyBaseLogger,
): Promise<void> {
  handle.markRunning()
  try {
    const outcome = await scanner.scan(input, {
      onProgress: (done, total) => {
        handle.updateProgress(done, total)
      },
    })
    handle.markDone(outcome)
    logger.info(
      {
        jobId: handle.job.jobId,
        totalFiles: outcome.totalFiles,
        scannedFiles: outcome.scannedFiles,
        failedFiles: outcome.failedFiles,
      },
      '扫描任务完成',
    )
  } catch (error: unknown) {
    // 完整异常（可能含路径）只进日志；job.error 只有一句中文
    logger.error({ err: error, jobId: handle.job.jobId }, '扫描任务执行失败')
    handle.markFailed()
  }
}

export interface ScanRouteDeps {
  readonly config: AppConfig
  readonly scanner: ScannerLike
  readonly logger: FastifyBaseLogger
}

export function registerScanRoutes(app: FastifyInstance, deps: ScanRouteDeps): void {
  let pending: Promise<void> | undefined
  const store = createScanJobStore({
    // run() 自己已经接住了 scan 的异常；走到这里说明是任务编排本身出错，
    // 必须留痕，否则只会看到一个没有原因的 failed 任务。
    onUnexpectedError: (error) => {
      deps.logger.error({ err: error }, '扫描任务异常终止')
    },
  })

  const enqueue = (input: ScanInput): ScanJob | null =>
    store.enqueue((handle) => {
      pending = runScan(deps.scanner, handle, input, deps.logger)
      return pending
    })
  const intervalMs = deps.config.watchIntervalMs ?? 0
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          enqueue({ rootDir: deps.config.dataRoot })
        }, intervalMs)
      : undefined
  timer?.unref()
  app.addHook('onClose', async () => {
    if (timer !== undefined) clearInterval(timer)
    await pending
  })

  app.post('/api/scan', async (request, reply) => {
    const parsed = parseScanBody(request.body)
    if (!parsed.ok) {
      throw new ApiError(400, parsed.error)
    }
    const input = toScanInput(parsed.value, deps.config)
    const job = enqueue(input)
    if (job === null) {
      const active = store.active()
      const busyWith = active === null ? '未知任务' : active.jobId
      throw new ApiError(409, `已有扫描任务在进行中（${busyWith}），请等待完成后再提交`)
    }
    // 刻意不记录请求体：里面可能带绝对路径，日志不该留存
    request.log.info({ jobId: job.jobId }, '扫描任务已入队')
    return sendData(reply, job)
  })

  app.get('/api/scan/:jobId', async (request, reply) => {
    const parsedId = parseJobId(request.params)
    if (!parsedId.ok) {
      throw new ApiError(400, parsedId.error)
    }
    const job = store.get(parsedId.value)
    if (job === null) {
      throw new ApiError(404, `未找到扫描任务：${parsedId.value}`)
    }
    return sendData(reply, job)
  })
}
