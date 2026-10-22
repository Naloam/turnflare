/**
 * @turnflare/core —— 会话解析
 *
 * 把单个 jsonl 会话文件解析为 `Session`：流式读行 → 归一化记录 → 提取 turns →
 * 汇总元信息。超大文件直接放弃解析而不是抛异常，避免一次扫描被单个坏文件带崩。
 */

import { statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { ParseError, RawRecord, Session, SessionMeta } from '../types.js'
import { isSyntheticModel } from '../synthetic.js'
import type { ParseOptions } from './types.js'
import { extractTurns, streamSessionRecords } from './records.js'

/** 单文件默认体积上限：50MB */
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024

/** 1MB，用于把字节数换算成人类可读的单位 */
const BYTES_PER_MB = 1024 * 1024

/** 超大文件的 ParseError 没有行号可指，用 0 表示"整文件级"错误 */
const FILE_LEVEL_LINE_NUMBER = 0

/**
 * 解析单个会话文件。
 *
 * - 流式读取，不在内存里持有整个文件的字符串；
 * - `Session.records` 保留全部归一化记录（跨包复用），turns 由其中派生；
 * - 超过 `maxFileBytes` 时返回空 Session 并附带一条整文件级 ParseError；
 * - 文件不存在时向上抛中文错误（由 `streamLines` 给出），调用方应自行兜底。
 *
 * 注意：本模块**不做 uuid 去重**——compaction 会让同一消息出现多次，
 * 按 uuid 去重是 stats 模块的职责（ARCHITECTURE.md §1.2 坑 5）。
 */
export function parseSessionFile(filePath: string, options?: ParseOptions): Session {
  const maxFileBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const projectSlug = basename(dirname(filePath))
  const sizeBytes = readFileSize(filePath)

  if (sizeBytes !== null && sizeBytes > maxFileBytes) {
    return {
      meta: buildMeta([], filePath, projectSlug),
      turns: [],
      records: [],
      parseErrors: [createOversizedError(sizeBytes, maxFileBytes)],
    }
  }

  const records: RawRecord[] = []
  const parseErrors: ParseError[] = []
  for (const record of streamSessionRecords(filePath, {
    onError: (error) => {
      parseErrors.push(error)
    },
  })) {
    records.push(record)
  }

  return {
    meta: buildMeta(records, filePath, projectSlug),
    turns: extractTurns(records, options),
    records,
    parseErrors,
  }
}

function buildMeta(
  records: readonly RawRecord[],
  filePath: string,
  projectSlug: string,
): SessionMeta {
  const models: string[] = []
  let sessionId = ''
  let cwd: string | null = null
  let gitBranch: string | null = null
  let cliVersion: string | null = null
  let startedAt: string | null = null
  let endedAt: string | null = null

  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : null
    const message = readRecord(payload, 'message')
    sessionId = sessionId || readSessionId(payload, message)
    cwd = cwd ?? readString(payload, 'cwd')
    gitBranch = gitBranch ?? readString(payload, 'gitBranch')
    cliVersion = cliVersion ?? readString(payload, 'version')
    if (record.timestamp !== null) {
      startedAt = startedAt ?? record.timestamp
      endedAt = record.timestamp
    }
    const model = readString(message, 'model')
    // 合成哨兵值不是真实模型，不能进 models 集合，否则 UI 会多出一个不存在的模型
    if (model !== null && !isSyntheticModel(model) && !models.includes(model)) {
      models.push(model)
    }
  }

  return {
    sessionId,
    filePath,
    projectSlug,
    cwd,
    gitBranch,
    cliVersion,
    startedAt,
    endedAt,
    models,
  }
}

/** sessionId 在真实数据里散落在三个位置，按优先级取第一个非空值 */
function readSessionId(
  payload: Record<string, unknown> | null,
  message: Record<string, unknown> | null,
): string {
  return (
    readString(payload, 'sessionId') ??
    readString(payload, 'session_id') ??
    readString(message, 'session_id') ??
    ''
  )
}

function createOversizedError(sizeBytes: number, maxFileBytes: number): ParseError {
  const actualMb = (sizeBytes / BYTES_PER_MB).toFixed(1)
  const limitMb = (maxFileBytes / BYTES_PER_MB).toFixed(1)
  return {
    lineNumber: FILE_LEVEL_LINE_NUMBER,
    message: `文件体积 ${actualMb}MB 超过上限 ${limitMb}MB，已跳过解析`,
    rawExcerpt: '',
  }
}

/** stat 失败时返回 null，由后续流式读取抛出更具体的错误 */
function readFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key]
  return isRecord(value) ? value : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' ? value : null
}
