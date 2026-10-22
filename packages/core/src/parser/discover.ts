/**
 * @turnflare/core —— 目录扫描
 *
 * 递归找出项目根目录下的全部 `*.jsonl`，并附带体积 / 修改时间，
 * 供上层做增量扫描（`filePath + mtimeMs + sizeBytes` 为键）。
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { DiscoveredFile, ScanError, ScanProjectsResult } from './types.js'

/** 会话文件扩展名 */
const JSONL_EXTENSION = '.jsonl'

/**
 * 默认数据源：`~/.claude/projects`。
 *
 * 惰性求值而不是模块级常量：`os.homedir()` 读的是运行时环境（POSIX 下取 `$HOME`），
 * 模块加载时就算死会让测试与"切换用户目录"的场景拿到过期路径。
 */
function defaultProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

/**
 * 扫描项目根目录，返回按 `filePath` 排序的会话文件列表。
 *
 * 返回值本身就是数组（可直接遍历 / map），另挂一个 `errors` 字段记录
 * 扫描过程中的非致命失败（目录不可读、文件无法 stat 等）——扫描整体不抛异常，
 * 单个坏文件不应该让一次全量扫描失败。
 *
 * `projectSlug` 始终取根目录下第一层项目名，包括嵌套的 subagent 文件。
 */
export async function scanProjects(rootDir?: string): Promise<ScanProjectsResult> {
  const root = rootDir ?? defaultProjectsRoot()
  const files: DiscoveredFile[] = []
  const errors: ScanError[] = []
  await walkDirectory(root, files, errors)
  const sorted = files
    .map((file) => ({ ...file, projectSlug: resolveProjectSlug(file.filePath, root) }))
    .toSorted(compareByFilePath)
  return Object.assign(sorted, { errors })
}

/** Resolve project ownership consistently for discovery and single-file scanning. */
export function resolveProjectSlug(filePath: string, rootDir: string): string {
  const segments = relative(rootDir, filePath).split(sep)
  const first = segments[0]
  if (segments.length > 1 && first !== undefined && first !== '' && first !== '..') {
    return first
  }
  return basename(dirname(filePath))
}

async function walkDirectory(
  directory: string,
  files: DiscoveredFile[],
  errors: ScanError[],
): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error: unknown) {
    errors.push({
      filePath: directory,
      message: `无法读取目录：${directory}（${describeError(error)}）`,
    })
    return
  }
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, files, errors)
      continue
    }
    // 软链同样交给 stat 裁决：断链自然会落进 errors，不会被静默丢弃
    const isCandidate = entry.isFile() || entry.isSymbolicLink()
    if (isCandidate && entry.name.endsWith(JSONL_EXTENSION)) {
      await collectFile(fullPath, files, errors)
    }
  }
}

async function collectFile(
  filePath: string,
  files: DiscoveredFile[],
  errors: ScanError[],
): Promise<void> {
  try {
    const stats = await fs.stat(filePath)
    files.push({
      filePath,
      projectSlug: basename(dirname(filePath)),
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    })
  } catch (error: unknown) {
    errors.push({
      filePath,
      message: `无法读取文件信息：${filePath}（${describeError(error)}）`,
    })
  }
}

/** 按码点比较而不是 localeCompare，保证跨机器结果一致 */
function compareByFilePath(a: DiscoveredFile, b: DiscoveredFile): number {
  if (a.filePath === b.filePath) {
    return 0
  }
  return a.filePath < b.filePath ? -1 : 1
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
