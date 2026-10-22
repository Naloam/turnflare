/**
 * @turnflare/core —— parser 模块私有类型
 *
 * 这些类型只在 parser 内部使用；跨包契约统一来自 `src/types.ts`（唯一真源）。
 */

import type { ParseError } from '../types.js'

/** 解析开关：调用方可通过它放宽体积上限与预览长度 */
export interface ParseOptions {
  /** 单文件最大字节数，超过则该文件被视为不可解析，默认 50MB */
  readonly maxFileBytes?: number
  /** `Turn.textPreview` 截断长度，默认 200 字符 */
  readonly maxTextPreviewChars?: number
}

/** 扫描发现的会话文件 */
export interface DiscoveredFile {
  readonly filePath: string
  /** 扫描根目录下第一层项目名，嵌套的 subagent 文件也属于该项目 */
  readonly projectSlug: string
  readonly sizeBytes: number
  readonly mtimeMs: number
}

/** 单条记录的流式读取开关 */
export interface StreamRecordOptions {
  /** 遇到无法解析的行时回调；不传则静默跳过 */
  readonly onError?: (error: ParseError) => void
}

/** 缓存写入的 TTL 拆分，供成本模块按 1h / 5m 分别计价 */
export interface CacheCreationSplit {
  readonly ephemeral1h: number
  readonly ephemeral5m: number
}

/** 一条 tool_result 的归一化结果 */
export interface ToolResultInfo {
  readonly toolUseId: string
  readonly isError: boolean
  /** 结果内容序列化后的字符数 */
  readonly resultBytes: number
}

/** 扫描过程中遇到的非致命错误（如无法 stat 的文件） */
export interface ScanError {
  readonly filePath: string
  readonly message: string
}

/**
 * `scanProjects` 的返回值：本质上就是 `readonly DiscoveredFile[]`（可直接当数组用），
 * 额外挂一个 `errors` 字段承载扫描过程中的非致命错误。
 */
export interface ScanProjectsResult extends ReadonlyArray<DiscoveredFile> {
  readonly errors: readonly ScanError[]
}
