/**
 * 什么样的 jsonl 才算"一场会话"。
 *
 * 实测背景：`~/.claude/projects` 下的 *.jsonl 不全是会话流水，还有相当一部分是
 * 插件遥测文件（例如 `<slug>/vercel-plugin/skill-injections.jsonl`），行长这样：
 *
 *   {"timestamp":"...","event":"skill-injection","toolName":"Write",...}
 *
 * 它们没有 `type` / `sessionId` / `message` 字段，core 的 parseSessionFile 会
 * 优雅降级成「sessionId 为空、turns 为空、parseErrors 为 0」的空 Session。
 * 若不在这里挡掉，扫描结果里会混进一批空会话，把 sessionCount 与所有聚合统计
 * 一起污染——而且因为是"合法解析"，下游没有任何办法发现异常。
 *
 * 判定刻意保持宽松：只要拿到 sessionId 且至少一条 turn 就认为是会话。
 * 真正的坏文件（读不了、JSON 全碎）走 Scanner 的失败分支，不走这里。
 */

import type { Session } from '@turnflare/core'

/**
 * 该文件是否是可入库的会话文件。
 *
 * @param session - core 解析出的会话（可能是遥测文件降级出的空会话）
 * @returns true 表示应当入库；false 表示应跳过且不计入失败
 */
export function isScannableSession(session: Session): boolean {
  const sessionId = session.meta.sessionId.trim()
  return sessionId.length > 0 && session.turns.length > 0
}
