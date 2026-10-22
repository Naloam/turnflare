/**
 * `turnflare models` —— 模型价目表。
 *
 * 数据全部来自 core 的 `MODEL_PRICING` / `FAST_PRICING`，CLI 不做任何加工：
 * 价目表的唯一真源在 core，这里只负责排版。
 */
import { FAST_PRICING, MODEL_PRICING, allModelIds } from '@turnflare/core'
import type { ModelPricing } from '@turnflare/core'
import { SUCCESS } from '../context.js'
import type { CliContext, Command, CommandResult } from '../context.js'
import type { ModelsOptions } from '../options.js'
import { createPalette, shouldUseColor } from '../color.js'
import { renderRows } from '../render/table.js'
import type { ColumnAlign } from '../render/table.js'

/** 单价保留两位小数：$0.10 / $12.50 */
const PRICE_DECIMALS = 2

const MONEY_ALIGNS: readonly ColumnAlign[] = ['left', 'right', 'right', 'right', 'right']

const FAST_MONEY_ALIGNS: readonly ColumnAlign[] = ['left', 'right', 'right']

function formatPrice(value: number): string {
  return `$${value.toFixed(PRICE_DECIMALS)}`
}

/** 标准价目行；表里没有的 ID 直接跳过（理论上不会发生，但不该因此崩） */
function standardRows(): readonly (readonly string[])[] {
  const rows: (readonly string[])[] = []
  for (const modelId of allModelIds()) {
    const pricing = MODEL_PRICING[modelId]
    if (pricing !== undefined) {
      rows.push(pricingRow(modelId, pricing))
    }
  }
  return rows
}

function pricingRow(modelId: string, pricing: ModelPricing): readonly string[] {
  return [
    modelId,
    formatPrice(pricing.input),
    formatPrice(pricing.output),
    formatPrice(pricing.cacheWrite),
    formatPrice(pricing.cacheRead),
  ]
}

/** fast 价目行 */
function fastRows(): readonly (readonly string[])[] {
  const rows: (readonly string[])[] = []
  for (const [modelId, pricing] of Object.entries(FAST_PRICING)) {
    rows.push([modelId, formatPrice(pricing.input), formatPrice(pricing.output)])
  }
  return rows
}

function renderJson(): string {
  return JSON.stringify({ models: MODEL_PRICING, fast: FAST_PRICING }, null, 2)
}

/**
 * 造 models 命令。
 *
 * 该命令不需要任何依赖注入：不碰数据库、不碰文件系统、不碰进程，
 * 纯函数即可完整测试。
 */
export function createModelsCommand(): Command<ModelsOptions> {
  return {
    name: 'models',
    description: '模型价目表',
    usage: 'turnflare models',
    run: (ctx: CliContext, options: ModelsOptions): CommandResult => {
      // JSON 分支先返回，根本不碰调色板：颜色控制字符混进 JSON 会让解析失败
      if (options.json) {
        ctx.stdout(`${renderJson()}\n`)
        return SUCCESS
      }

      const palette = createPalette(shouldUseColor(ctx.env, false))
      ctx.stdout(`${palette.bold('模型价目表')}（美元 / 百万 token）\n\n`)
      ctx.stdout(
        `${renderRows(['模型', '输入', '输出', '缓存写', '缓存读'], standardRows(), '价目表为空', MONEY_ALIGNS)}\n\n`,
      )
      ctx.stdout(`${palette.bold('fast 模式价目')}\n\n`)
      ctx.stdout(
        `${renderRows(['模型', '输入', '输出'], fastRows(), '暂无支持 fast 模式的模型', FAST_MONEY_ALIGNS)}\n\n`,
      )
      ctx.stdout(
        `${palette.dim('注：缓存写为 5 分钟 TTL 价，1 小时 TTL 价为输入价的 2 倍；fast 模式只覆盖部分 Opus 模型。')}\n`,
      )
      return SUCCESS
    },
  }
}
