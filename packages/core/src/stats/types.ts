/**
 * @turnflare/core —— stats 模块私有类型
 *
 * 跨包契约一律来自 `src/types.ts`（唯一真源，只读）；本文件只放 stats 内部
 * 以及 stats 与集成层之间的装配类型。
 *
 * 聚合选项是引擎的行为配置，不属于序列化的跨包数据契约。
 */

import type { CostBreakdown, TokenUsage } from '../types.js'

/**
 * 成本计算器。
 *
 * 允许调用方选择计价策略。未提供时明确标记为无价目，避免把缺失价格
 * 误认为免费。集成入口把默认成本引擎适配为此函数。
 */
export interface CostCalculator {
  (usage: TokenUsage, model: string): CostBreakdown
}

/** 聚合选项 */
export interface AggregateOptions {
  /** 时区偏移分钟数，默认 0（UTC）；正数表示东八区（+480） */
  readonly timezoneOffsetMinutes?: number
  /** 是否计入 subagent 侧链，默认 false（排除 isSidechain 的 turn） */
  readonly includeSidechain?: boolean
  /** 只统计该时刻之后的 turn（闭区间下界：timestamp >= since） */
  readonly since?: string
  /** 只统计该时刻之前的 turn（开区间上界：timestamp < until） */
  readonly until?: string
  /** 成本计算器；不传则所有成本为 0 */
  readonly costCalculator?: CostCalculator
}

/** 时间分桶粒度 */
export interface BucketGranularity {
  readonly kind: 'hour' | 'day'
}
