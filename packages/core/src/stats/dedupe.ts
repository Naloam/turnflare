/**
 * @turnflare/core —— 去重
 *
 * compaction 会让同一条消息在 jsonl 里出现多次（ARCHITECTURE.md §1.2 坑 5），
 * 聚合前必须按 uuid 去掉副本，否则 token 用量会被重复计入。
 *
 * 保留首次出现：首次那条携带的 tool_result 配对信息最完整，
 * 后面的副本往往是压缩后重新写入的残片。
 */

import type { RawRecord, Turn } from '../types.js'
import { isPlainObject, readNonEmptyString } from './narrow.js'

/**
 * 按 uuid 去掉重复的 turn，保留首次出现。
 *
 * 没有 uuid（缺失或空串）的 turn 无法判断是否重复，一律原样保留 ——
 * 把它们误判成同一个副本会静默吞掉真实数据。
 */
export function dedupeTurns(turns: readonly Turn[]): readonly Turn[] {
  const seen = new Set<string>()
  const deduped: Turn[] = []
  for (const turn of turns) {
    if (!isPlainObject(turn)) {
      deduped.push(turn)
      continue
    }
    const uuid = readNonEmptyString(turn.uuid)
    if (uuid === null) {
      deduped.push(turn)
      continue
    }
    if (seen.has(uuid)) {
      continue
    }
    seen.add(uuid)
    deduped.push(turn)
  }
  return deduped
}

/**
 * 按 `payload.uuid` 去掉重复的原始记录，保留首次出现。
 *
 * payload 不是对象（截断行、标量行）时没有 uuid 可依，原样保留。
 */
export function dedupeRecords(records: readonly RawRecord[]): readonly RawRecord[] {
  const seen = new Set<string>()
  const deduped: RawRecord[] = []
  for (const record of records) {
    const uuid = readRecordUuid(record)
    if (uuid === null) {
      deduped.push(record)
      continue
    }
    if (seen.has(uuid)) {
      continue
    }
    seen.add(uuid)
    deduped.push(record)
  }
  return deduped
}

/** uuid 只认 payload 顶层；嵌套位置（如 message.uuid）不是记录身份 */
function readRecordUuid(record: RawRecord): string | null {
  if (!isPlainObject(record)) {
    return null
  }
  if (!isPlainObject(record.payload)) {
    return null
  }
  return readNonEmptyString(record.payload['uuid'])
}
