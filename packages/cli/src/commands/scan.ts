/**
 * `turnflare scan` —— 扫描会话记录并落库。
 *
 * 增量逻辑全在 api 包的 `Scanner` 里（以 filePath + mtime + size 为指纹），
 * CLI 只做四件事：定位根目录、开库、把进度回调接到进度条上、把结果说清楚。
 *
 * 单文件失败不算命令失败：Scanner 会把原因收进 `failures`，扫描整体仍然
 * 成功——否则一个坏文件就能让整晚的扫描白跑。
 */
import { statSync } from 'node:fs'
import { Scanner } from '@turnflare/api'
import type { ScanOutcome } from '../api-types.js'
import { SUCCESS, failure } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { ScanOptions } from '../options.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure } from './shared.js'
import { createSilentProgress } from '../progress.js'
import type { ProgressReporter } from '../progress.js'
import { createPalette, shouldUseColor } from '../color.js'

export interface ScanDeps extends StorageDeps {
  /** 进度条工厂；测试注入静音实现，`--json` 模式强制静音 */
  readonly createProgress: (options: { readonly enabled: boolean }) => ProgressReporter
}

/** 目录不存在时报的错：这是最常见的"扫描没结果"原因，必须说清楚 */
function describeRootProblem(rootDir: string): string | null {
  let stats: ReturnType<typeof statSync> | undefined
  try {
    stats = statSync(rootDir, { throwIfNoEntry: false })
  } catch {
    return `无法读取扫描根目录：${rootDir}`
  }
  if (stats === undefined) {
    return `扫描根目录不存在：${rootDir}`
  }
  return stats.isDirectory() ? null : `扫描根目录不是目录：${rootDir}`
}

function buildSummary(outcome: ScanOutcome): string {
  const base = `已扫描 ${String(outcome.scannedFiles)} 个会话（跳过 ${String(outcome.skippedEmpty)} 个非会话文件，跳过 ${String(outcome.skippedFiles)} 个未变化文件）`
  return outcome.failedFiles > 0 ? `${base}，失败 ${String(outcome.failedFiles)} 个文件` : base
}

function renderJson(outcome: ScanOutcome, rootDir: string, dbPath: string): string {
  return JSON.stringify(
    {
      rootDir,
      dbPath,
      totalFiles: outcome.totalFiles,
      scannedFiles: outcome.scannedFiles,
      skippedEmpty: outcome.skippedEmpty,
      skippedFiles: outcome.skippedFiles,
      failedFiles: outcome.failedFiles,
      failures: outcome.failures,
    },
    null,
    2,
  )
}

export function createScanCommand(deps: ScanDeps): Command<ScanOptions> {
  return {
    name: 'scan',
    description: '扫描 Claude Code 会话记录并写入数据库',
    usage: 'turnflare scan [--root DIR] [--project SLUG] [--since DATE] [--force]',
    run: async (ctx: CliContext, options: ScanOptions): Promise<CommandResult> => {
      const storage = openStorageFromEnv(ctx.env, deps)
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      // 根目录默认值复用 api 的数据根目录口径（TURNFLARE_DATA_ROOT 或 ~/.claude/projects）
      const rootDir = options.root ?? storage.config.dataRoot
      const problem = describeRootProblem(rootDir)
      if (problem !== null) {
        closeStorage(storage.db)
        return failure(1, problem)
      }

      const progress = options.json
        ? createSilentProgress()
        : deps.createProgress({ enabled: shouldUseColor(ctx.env, false) })

      const scanner = new Scanner({
        repo: storage.repo,
        config: storage.config,
        onProgress: (done, total) => {
          progress.advance(done, total)
        },
      })

      try {
        const outcome = await scanner.scan({
          rootDir,
          ...(options.projects.length > 0 ? { projectSlugs: options.projects } : {}),
          ...(options.since === undefined ? {} : { since: options.since }),
          ...(options.force ? { force: true } : {}),
        })
        progress.stop()

        if (options.json) {
          ctx.stdout(`${renderJson(outcome, rootDir, storage.dbPath)}\n`)
        } else {
          const palette = createPalette(shouldUseColor(ctx.env, false))
          ctx.stdout(`扫描根目录：${rootDir}\n`)
          ctx.stdout(`${palette.green(buildSummary(outcome))}\n`)
          for (const item of outcome.failures) {
            ctx.stderr(`扫描失败：${item.filePath} —— ${item.reason}\n`)
          }
        }
        return SUCCESS
      } catch (error: unknown) {
        progress.stop()
        return runtimeFailure(ctx, error, '扫描失败')
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
