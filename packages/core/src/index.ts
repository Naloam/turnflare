/**
 * @turnflare/core —— Claude Code 会话解析、统计与成本引擎。
 *
 * 零运行时依赖：只使用 node: 内置模块，可在任何 Node >= 20.19 环境运行。
 *
 * 公开 API 表面：
 *   解析   parseSessionFile / streamSessionRecords / scanProjects / streamLines
 *         normalizeUsage / extractTurns / extractTools / extractToolResults
 *   统计   aggregate / bucketByHour / bucketByDay / dedupeTurns / aggregateTools
 *         emptyUsage / addUsage / usageTotal / cacheHitRate
 *   成本   priceFor / costOf / costOfWithSplit / sumCosts / normalizeModelId
 *         MODEL_PRICING / FAST_PRICING / allModelIds
 *   格式化 formatTokens / formatCost / formatDuration / relativeTime / formatPercent
 *
 * 类型契约见 ./types.ts，计价规则见 docs/PRICING.md。
 */

export * from './types.js'

export * from './synthetic.js'
export * from './parser/index.js'
export * from './stats/index.js'
export * from './cost/index.js'
export * from './format/index.js'
