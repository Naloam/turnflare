/**
 * @turnflare/core —— 工具调用统计
 *
 * 统计口径来自 `Turn.tools`（parser 已把 tool_use 与后续的 tool_result 配对好），
 * 因此这里只做分组汇总，不再回原始记录里找配对关系。
 */

import type { ToolInvocation, ToolStats, Turn } from '../types.js'
import { isArrayValue, isPlainObject, readNonEmptyString, readPositiveNumber } from './narrow.js'

/** 单个工具的累加器；每次更新都整体替换成新对象 */
interface ToolAccumulator {
  readonly callCount: number
  readonly errorCount: number
  readonly totalResultBytes: number
}

const EMPTY_ACCUMULATOR: ToolAccumulator = Object.freeze({
  callCount: 0,
  errorCount: 0,
  totalResultBytes: 0,
})

/**
 * 汇总所有 turn 的工具调用。
 *
 * 按 callCount 降序；callCount 相同时按工具名升序，保证同样输入永远得到
 * 同样顺序（否则同样数据的两次请求会返回不同排序，前端会无故重渲染）。
 *
 * @param turns - 待统计的 turn 数组，函数不修改入参
 * @returns 工具统计数组；没有任何调用时返回空数组
 */
export function aggregateTools(turns: readonly Turn[]): readonly ToolStats[] {
  const accumulators = new Map<string, ToolAccumulator>()
  for (const turn of turns) {
    accumulateTurn(accumulators, turn)
  }
  return [...accumulators.entries()].sort(compareByCallCount).map(([toolName, accumulator]) => ({
    toolName,
    callCount: accumulator.callCount,
    errorCount: accumulator.errorCount,
    totalResultBytes: accumulator.totalResultBytes,
  }))
}

/**
 * 工具调用出错率 = 出错调用数 / 总调用数。
 *
 * 一次调用都没有时返回 0（分母为 0 的比率没有意义，也不该是 NaN）。
 */
export function toolErrorRate(stats: readonly ToolStats[]): number {
  let callCount = 0
  let errorCount = 0
  for (const entry of stats) {
    if (!isPlainObject(entry)) {
      continue
    }
    callCount += readPositiveNumber(entry.callCount)
    errorCount += readPositiveNumber(entry.errorCount)
  }
  if (callCount <= 0) {
    return 0
  }
  const rate = errorCount / callCount
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0
}

function accumulateTurn(accumulators: Map<string, ToolAccumulator>, turn: Turn): void {
  if (!isPlainObject(turn) || !isArrayValue(turn.tools)) {
    return
  }
  for (const tool of turn.tools) {
    accumulateTool(accumulators, tool)
  }
}

function accumulateTool(accumulators: Map<string, ToolAccumulator>, tool: ToolInvocation): void {
  if (!isPlainObject(tool)) {
    return
  }
  const toolName = readNonEmptyString(tool.toolName)
  if (toolName === null) {
    // 没有名字的调用无法归属到任何工具，只能丢弃；硬塞一个空串分组只会污染排序
    return
  }
  const previous = accumulators.get(toolName) ?? EMPTY_ACCUMULATOR
  const isError = tool.isError === true
  accumulators.set(toolName, {
    callCount: previous.callCount + 1,
    errorCount: previous.errorCount + (isError ? 1 : 0),
    totalResultBytes: previous.totalResultBytes + readPositiveNumber(tool.resultBytes),
  })
}

function compareByCallCount(
  left: readonly [string, ToolAccumulator],
  right: readonly [string, ToolAccumulator],
): number {
  const byCallCount = right[1].callCount - left[1].callCount
  if (byCallCount !== 0) {
    return byCallCount
  }
  return compareText(left[0], right[0])
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}
