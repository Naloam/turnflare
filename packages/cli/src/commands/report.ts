/**
 * `turnflare report` —— 导出报表。
 *
 * 渲染完全复用 api 包的 report 模块（`collectReportData` + `renderReport`）：
 * 四种格式的排版、HTML 的自包含 SVG 图表、CSV 的列序都在那边实现，
 * CLI 重复一遍必然漂移。这里只决定"渲染成什么"和"写到哪去"。
 *
 * `--json` 与 `--format` 的关系：`--json` 是"我要机器可读"的意图表达，
 * 因此它优先于 `--format`；写文件时的确认信息也随之切成 JSON，
 * 保证 stdout 在 --json 模式下永远可以被 parse。
 */
import path from 'node:path'
import { formatBytes } from '@turnflare/core'
import type { CollectReportDataFn, RenderReportFn, SessionRepository } from '../api-types.js'
import { SUCCESS } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { ReportFormatName, ReportOptions } from '../options.js'
import type { StorageDeps } from '../storage.js'
import { closeStorage, openStorageFromEnv } from '../storage.js'
import { runtimeFailure, storageFailure } from './shared.js'

export interface ReportDeps extends StorageDeps {
  readonly collectReportData: CollectReportDataFn
  readonly renderReport: RenderReportFn
  /** 写文件；测试注入内存实现，不碰真实磁盘 */
  readonly writeFile: (filePath: string, content: string) => void
}

function resolveFormat(options: ReportOptions): ReportFormatName {
  return options.json ? 'json' : options.format
}

/** 取数一次、渲染一次；`generatedAt` 由命令给定，报告内外时间一致 */
function render(
  repo: SessionRepository,
  format: ReportFormatName,
  deps: ReportDeps,
): { readonly body: string; readonly bytes: number } {
  const generatedAt = new Date().toISOString()
  const rendered = deps.renderReport(deps.collectReportData(repo, generatedAt), format)
  return { body: rendered.body, bytes: Buffer.byteLength(rendered.body, 'utf8') }
}

export function createReportCommand(deps: ReportDeps): Command<ReportOptions> {
  return {
    name: 'report',
    description: '导出报表（html / markdown / csv / json）',
    usage: 'turnflare report [--format FMT] [--out FILE]',
    run: (ctx: CliContext, options: ReportOptions): CommandResult => {
      const storage = openStorageFromEnv(ctx.env, deps, { requireExisting: true })
      if (storage.kind !== 'ok') {
        return storageFailure(storage)
      }

      const format = resolveFormat(options)
      try {
        const { body, bytes } = render(storage.repo, format, deps)

        if (options.out === undefined) {
          ctx.stdout(body.endsWith('\n') ? body : `${body}\n`)
          return SUCCESS
        }

        const target = path.resolve(ctx.cwd, options.out)
        deps.writeFile(target, body)
        if (options.json) {
          ctx.stdout(`${JSON.stringify({ path: target, bytes, format }, null, 2)}\n`)
        } else {
          ctx.stdout(`已写入 ${target}（${formatBytes(bytes)}）\n`)
        }
        return SUCCESS
      } catch (error: unknown) {
        return runtimeFailure(ctx, error, `生成报表失败（格式：${format}）`)
      } finally {
        closeStorage(storage.db)
      }
    },
  }
}
