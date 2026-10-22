/**
 * 命令实现的公共零件。
 *
 * 六个数据类命令的开场白完全一样：打开存储、失败就退出、finally 关连接。
 * 这段骨架放在这里只写一次，命令文件里只剩"自己的业务"。
 */
import { failure } from '../context.js'
import type { CliContext, CommandResult } from '../context.js'
import { toReason, type StorageResult } from '../storage.js'

/** 存储层失败 → 命令结果 */
export function storageFailure(
  result: Exclude<StorageResult, { readonly kind: 'ok' }>,
): CommandResult {
  if (result.kind === 'missing') {
    return failure(1, `数据库不存在：${result.dbPath}，请先运行 turnflare scan`)
  }
  return failure(1, result.message)
}

/**
 * 运行时异常 → 命令结果。
 *
 * 分工：`summary` 是给人看的一句话（进 message，由分发层写到 stderr），
 * 底层原因进 stderr 细节区。两条都走 stderr——stdout 只承载结果与 JSON。
 */
export function runtimeFailure(ctx: CliContext, error: unknown, summary: string): CommandResult {
  ctx.stderr(`原因：${toReason(error)}\n`)
  return failure(1, summary)
}

/** 无价目模型的醒目警告（ARCHITECTURE.md：绝不猜价格，但要告诉用户） */
export const UNPRICED_WARNING = '⚠ 部分模型无价目数据（如 step-5-preview），成本未计入总额'
