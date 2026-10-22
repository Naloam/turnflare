/**
 * @turnflare/api —— 增量扫描器。
 *
 * 职责：把磁盘上的 jsonl 会话文件变成库里的行。三步走——
 *   1. 遍历（filewalker.ts）拿到候选文件；
 *   2. 逐个解析（core 的 parseSessionFile）；
 *   3. 落库（SessionRepository.upsertSession + mergeSessionTurns）。
 *
 * 三条不可破的行为约定：
 *   - **增量**：以 (filePath, mtimeMs, sizeBytes) 为键，没变过的文件不重新解析；
 *   - **不中断**：单个文件失败只记进 failures，绝不让整次扫描失败；
 *   - **并发受控**：同时跑的文件数不超过 config.scanConcurrency。
 */

import { parseSessionFile, resolveProjectSlug } from '@turnflare/core'
import type { DiscoveredFile } from '@turnflare/core'
import { stat } from 'node:fs/promises'
import type { AppConfig } from '../config.js'
import type { FileStamp, SessionRepository } from '../db/repository.js'
import { isScannableSession } from './session-filter.js'
import { parseSince, walkSessionFiles } from './filewalker.js'

// 判定"什么算一场会话"的逻辑单独放在 session-filter.ts：它来自对
// ~/.claude/projects 真实数据的观察，与扫描流程本身无关，值得独立测试。
export { isScannableSession } from './session-filter.js'

export interface ScanInput {
  readonly rootDir: string
  readonly projectSlugs?: readonly string[]
  readonly since?: string
  readonly force?: boolean
}

export interface ScanOutcome {
  readonly totalFiles: number
  readonly scannedFiles: number
  readonly skippedFiles: number
  /** 解析成功但不算一场会话的文件数（空文件、纯元数据文件、插件遥测文件） */
  readonly skippedEmpty: number
  readonly failedFiles: number
  readonly failures: readonly { filePath: string; reason: string }[]
}

export interface ScannerDeps {
  readonly repo: SessionRepository
  readonly config: AppConfig
  readonly onProgress?: (done: number, total: number, filePath: string) => void
}

/** 单个文件的扫描结果 */
type FileOutcome =
  | { readonly kind: 'scanned'; readonly filePath: string }
  | { readonly kind: 'skipped'; readonly filePath: string }
  | { readonly kind: 'skipped-empty'; readonly filePath: string }
  | { readonly kind: 'failed'; readonly filePath: string; readonly reason: string }

/** 把 unknown 异常收敛成一句可读原因，写进 failures 给人看 */
function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/** 读文件的实时指纹；文件读不到时抛中文可读错误 */
async function readFileStamp(filePath: string): Promise<FileStamp> {
  try {
    const stats = await stat(filePath)
    return { filePath, mtimeMs: stats.mtimeMs, sizeBytes: stats.size }
  } catch (error: unknown) {
    throw new Error(`读取文件信息失败：${filePath}（${toReason(error)}）`, { cause: error })
  }
}

/** 已入库指纹 → (filePath → FileStamp) */
function indexStamps(stamps: readonly FileStamp[]): ReadonlyMap<string, FileStamp> {
  return new Map(stamps.map((stamp) => [stamp.filePath, stamp] as const))
}

/**
 * 这个文件相对上次扫描有没有变化。
 *
 * 三个字段全同比一遍：只比 mtime 会漏掉"同一毫秒内被改写"的情况，
 * 只比 size 会漏掉等长改写。库里没有这个文件的记录时视为"有新文件"。
 */
function hasChanged(stamp: FileStamp, stamps: ReadonlyMap<string, FileStamp>): boolean {
  const known = stamps.get(stamp.filePath)
  if (known === undefined) {
    return true
  }
  return known.mtimeMs !== stamp.mtimeMs || known.sizeBytes !== stamp.sizeBytes
}

/**
 * 简单的 Promise 池。
 *
 * 不引第三方依赖：本地的文件解析与 SQLite 写入都是同步操作，现在还跑不出真正
 * 的并行，但这个结构保证将来任何一步变成异步时，并发度天然受 config 约束，
 * 不会一次性把文件描述符或内存打满。共享一个迭代器来分配任务，比按下标取更
 * 不容易写错边界。
 */
async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const queue = items.entries()
  const laneCount = Math.max(1, Math.min(concurrency, items.length))
  const lanes = Array.from({ length: laneCount }, async () => {
    const results: R[] = []
    for (const item of queue) {
      results.push(await worker(item[1]))
    }
    return results
  })
  const settled = await Promise.all(lanes)
  return settled.flat()
}

export class Scanner {
  private readonly repo: SessionRepository
  private readonly config: AppConfig
  private readonly onProgress: ScannerDeps['onProgress']

  constructor(deps: ScannerDeps) {
    this.repo = deps.repo
    this.config = deps.config
    this.onProgress = deps.onProgress
  }

  /** 触发一次扫描；单文件失败不会中断整体 */
  async scan(input: ScanInput): Promise<ScanOutcome> {
    const sinceMs = parseSince(input.since)
    const isForced = input.force === true
    const { files, discoveryFailures } = await this.collectFiles(input, sinceMs)
    const stamps = indexStamps(this.repo.getFileStamps())

    let done = 0
    const outcomes = await runPool(files, this.config.scanConcurrency, async (file) => {
      const outcome = await this.scanFile(file.filePath, stamps, isForced, input.rootDir)
      done += 1
      this.onProgress?.(done, files.length, file.filePath)
      return outcome
    })

    const scannedFiles = outcomes.filter((outcome) => outcome.kind === 'scanned').length
    const skippedFiles = outcomes.filter((outcome) => outcome.kind === 'skipped').length
    const skippedEmpty = outcomes.filter((outcome) => outcome.kind === 'skipped-empty').length
    const scanFailures = outcomes.flatMap((outcome) =>
      outcome.kind === 'failed' ? [{ filePath: outcome.filePath, reason: outcome.reason }] : [],
    )
    // failedFiles 必须等于 failures 的长度：一个是给人看的计数，一个是给人看的明细，
    // 两个数字对不上比没有计数更糟。遍历期的失败同样算失败文件。
    const failures = [...discoveryFailures, ...scanFailures]

    return {
      totalFiles: files.length,
      scannedFiles,
      skippedFiles,
      skippedEmpty,
      failedFiles: failures.length,
      failures,
    }
  }

  /**
   * 扫描单个文件，返回"是否有变化"。
   *
   * 与 scan() 的区别只在不做增量跳过之外的全部前置工作：这个入口给"用户明确
   * 指定了一个文件"的场景用（例如 API 触发的单文件重扫），因此失败时抛错而不是
   * 记进 failures——调用方需要知道这一次到底成没成。
   */
  async scanOneFile(filePath: string): Promise<boolean> {
    const stamps = indexStamps(this.repo.getFileStamps())
    // 单文件重扫没有 scan(input) 那样的 rootDir 上下文，用配置里的数据根兜底
    const outcome = await this.scanFile(filePath, stamps, false, this.config.dataRoot)
    if (outcome.kind === 'failed') {
      throw new Error(`扫描文件失败：${filePath} —— ${outcome.reason}`)
    }
    return outcome.kind === 'scanned'
  }

  /** 遍历 + 项目/时间过滤，分出候选文件与遍历期失败 */
  private async collectFiles(
    input: ScanInput,
    sinceMs: number | null,
  ): Promise<{
    files: readonly DiscoveredFile[]
    discoveryFailures: readonly { filePath: string; reason: string }[]
  }> {
    const files: DiscoveredFile[] = []
    const discoveryFailures: { filePath: string; reason: string }[] = []

    for await (const item of walkSessionFiles({
      rootDir: input.rootDir,
      projectSlugs: input.projectSlugs,
      sinceMs: sinceMs ?? undefined,
    })) {
      if (item.kind === 'file') {
        files.push(item.file)
      } else {
        discoveryFailures.push({ filePath: item.filePath, reason: item.message })
      }
    }

    return { files, discoveryFailures }
  }

  /** 单文件扫描；任何异常都收敛成 failed 结果，不向外抛 */
  private async scanFile(
    filePath: string,
    stamps: ReadonlyMap<string, FileStamp>,
    isForced: boolean,
    rootDir: string,
  ): Promise<FileOutcome> {
    try {
      // 指纹在解析前重新读一次：遍历时拿到的 mtime 可能已经过期，
      // 用过期指纹入库会让"文件确实变了"这件事永远补不上。
      const stamp = await readFileStamp(filePath)
      if (!isForced && !hasChanged(stamp, stamps)) {
        return { kind: 'skipped', filePath }
      }

      const session = parseSessionFile(filePath, { maxFileBytes: this.config.maxFileBytes })
      if (!isScannableSession(session)) {
        return { kind: 'skipped-empty', filePath }
      }

      // 项目归属按文件路径推导，不用 session 自带的（见 resolveProjectSlug）
      const projectSlug = resolveProjectSlug(filePath, rootDir)
      this.repo.upsertSession(
        projectSlug === session.meta.projectSlug
          ? session
          : { ...session, meta: { ...session.meta, projectSlug } },
        stamp,
      )
      // meta 的时间范围要一起传下去：turns 表里的时间戳可能缺失（早期版本、
      // 测试夹具），而合并语义要求"取较早/较晚者"而不是后者覆盖前者。
      this.repo.mergeSessionTurns(session.meta.sessionId, session.turns, {
        startedAt: session.meta.startedAt,
        endedAt: session.meta.endedAt,
      })
      return { kind: 'scanned', filePath }
    } catch (error: unknown) {
      return { kind: 'failed', filePath, reason: toReason(error) }
    }
  }
}
