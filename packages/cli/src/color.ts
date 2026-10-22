/**
 * 颜色开关与调色板。
 *
 * 两条硬规则：
 *   1. `--json` 模式下绝不上色——颜色控制字符会让 JSON 解析失败；
 *   2. 非 TTY（管道、重定向、CI）与 `NO_COLOR` 环境下绝不上色。
 *
 * 判定逻辑与上色逻辑分开：判定是纯函数（可单测），上色通过注入的调色板
 * 进入命令实现，命令里因此看不到 `process`。
 */
import pc from 'picocolors'

/** 命令实现用到的颜色集合 */
export interface Palette {
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
  readonly cyan: (text: string) => string
  readonly green: (text: string) => string
  readonly yellow: (text: string) => string
  readonly red: (text: string) => string
}

/** 原样返回；JSON 模式与非 TTY 环境用它 */
const identity = (text: string): string => text

export const PLAIN_PALETTE: Palette = Object.freeze({
  bold: identity,
  dim: identity,
  cyan: identity,
  green: identity,
  yellow: identity,
  red: identity,
})

export const COLOR_PALETTE: Palette = Object.freeze({
  bold: pc.bold,
  dim: pc.dim,
  cyan: pc.cyan,
  green: pc.green,
  yellow: pc.yellow,
  red: pc.red,
})

/**
 * 是否启用颜色。
 *
 * `NO_COLOR` 按社区规范处理：只要存在且非空即禁用（空串视为未设置，
 * 与 picocolors 自身的口径一致，避免两处判定打架）。
 */
export function shouldUseColor(env: NodeJS.ProcessEnv, isJsonOutput: boolean): boolean {
  if (isJsonOutput) {
    return false
  }
  const noColor = env.NO_COLOR
  if (noColor !== undefined && noColor !== '') {
    return false
  }
  return pc.isColorSupported
}

/** 按开关取调色板；关闭时返回共享的原样实现 */
export function createPalette(enabled: boolean): Palette {
  return enabled ? COLOR_PALETTE : PLAIN_PALETTE
}
