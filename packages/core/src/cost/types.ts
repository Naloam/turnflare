/**
 * @turnflare/core —— 成本引擎类型
 *
 * 价格表与计算规则的唯一真源是 docs/PRICING.md，本文件只放跨文件共享的类型。
 *
 * `CostBreakdown`（含 unpricedModel / isEstimated 两个标记位）定义在 src/types.ts
 * 的冻结契约中，从这里重新导出，保证整个 core 只有一份定义。
 */

import type { ModelPricing, TokenUsage } from '../types.js'

export type { CostBreakdown } from '../types.js'

/** 成本计算的输入：一次模型调用的 token 用量 + 模型 + 速度档位 */
export interface CostInput {
  readonly usage: TokenUsage
  readonly model: string
  /**
   * 显式指定计费档位；fast 仅部分 Opus 模型支持（PRICING.md §2.2）。
   *
   * 优先级是**显式入参 > usage 自带 > 都缺则 standard**（见 `costOfWithSplit`
   * 的 `input.speed ?? usage.speed`）：调用方不传时用的是 `usage.speed`，
   * 而 `normalizeUsage` 对缺失/非法值一律补 standard，所以"都缺"才会落到
   * standard。别把这里当成"不传就是 standard"的开关——那会覆盖掉 usage 里
   * 已经带对的档位。
   */
  readonly speed?: 'standard' | 'fast'
}

/** 缓存写的 TTL 拆分，对应 jsonl `usage.cache_creation` */
export interface CacheWriteSplit {
  readonly ephemeral1h: number
  readonly ephemeral5m: number
}

/** 价格查询结果；`pricing` 为 null 表示该模型无价目数据 */
export interface PriceLookup {
  readonly pricing: ModelPricing | null
  readonly normalizedModel: string
  readonly isEstimated: boolean
}
