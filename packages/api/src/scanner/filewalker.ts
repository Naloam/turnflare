/**
 * @turnflare/api —— 会话文件遍历。
 *
 * 目录发现委托给 core 的 `scanProjects`（它已经处理了递归、排序、单文件 stat
 * 失败不中断），本模块只做两件 core 不做的事：按项目过滤、按时间过滤，并把
 * "发现过程中的非致命失败"和"待扫描文件"统一成一条产出流。
 *
 * 为什么是 async generator：扫描可能是几十万行的目录树，调用方拿到的是一个
 * 可以边取边处理的流，而不是必须先全量拿到手的数组。
 */

import { scanProjects } from '@turnflare/core'
import type { DiscoveredFile, ScanError } from '@turnflare/core'

export interface WalkOptions {
  readonly rootDir: string
  /** 只遍历这些项目 slug；不传（或空数组）表示全部 */
  readonly projectSlugs?: readonly string[] | undefined
  /** 只遍历内容可能写于该时刻（epoch 毫秒）之后的文件 */
  readonly sinceMs?: number | undefined
}

/** 遍历产出：要么是一个待扫描文件，要么是一次遍历期的非致命失败 */
export type WalkItem =
  | { readonly kind: 'file'; readonly file: DiscoveredFile }
  | { readonly kind: 'error'; readonly filePath: string; readonly message: string }

/**
 * 解析 `since` 过滤条件为 epoch 毫秒。
 *
 * 非法值立刻抛错而不是静默忽略：一个写错的时间如果被当成"没有过滤"，
 * 扫描范围会悄悄放大到全量，而这种偏差在结果上看不出来。
 */
export function parseSince(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`since 不是合法的时间字符串：${value}`)
  }
  return ms
}

/**
 * 遍历项目根目录，产出待扫描文件。
 *
 * `since` 用**文件 mtime** 做前置过滤，而不是等解析完再看会话开始时间：
 * 一条记录的写入时刻不可能晚于文件最后一次修改，所以 mtime 早于 `since` 的
 * 文件里不可能有 `since` 之后的活动——这个前置判断是精确的，却能省掉整棵子树
 * 的解析开销。极端情况（客户端时钟错乱导致记录时间晚于 mtime）会漏文件，
 * 下一次不带 `since` 的全量扫描会补上。
 */
export async function* walkSessionFiles(
  options: WalkOptions,
): AsyncGenerator<WalkItem, void, void> {
  const discovered = await scanProjects(options.rootDir)
  const wanted = new Set(options.projectSlugs ?? [])
  const hasProjectFilter = wanted.size > 0

  for (const error of discovered.errors) {
    yield toWalkError(error)
  }

  for (const file of discovered) {
    if (hasProjectFilter && !wanted.has(file.projectSlug)) {
      continue
    }
    if (options.sinceMs !== undefined && file.mtimeMs < options.sinceMs) {
      continue
    }
    yield { kind: 'file', file }
  }
}

function toWalkError(error: ScanError): WalkItem {
  return { kind: 'error', filePath: error.filePath, message: error.message }
}
