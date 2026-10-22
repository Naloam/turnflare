/**
 * @turnflare/core —— 不可信输入的窄化助手
 *
 * `Turn` / `TokenUsage` 这类契约类型只描述"正常路径"，而 jsonl 是外部数据：
 * 字段可能缺失、类型不对、值是 NaN，甚至整条记录不是对象。
 * 本文件把"这个值敢不敢用"的判据集中到一处，stats 其余模块只跟这些助手打交道，
 * 避免每个文件各写一份口径不一的兜底逻辑。
 *
 * 注意：本文件是 stats 的内部模块，不进入公开 API 表面（index.ts 不导出它）。
 */

/**
 * 值是不是「可以当字典用」的普通对象。
 *
 * 排除 null 与数组：`typeof null === 'object'`，而数组虽然也是对象，
 * 但按下标读字段会得到 undefined，两种形态都必须在这里挡掉。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 值是不是数组。
 *
 * TS 的 `Array.isArray` 不会窄化 `readonly T[]`（会窄化成 `any[]`），
 * 因此统一按 `unknown` 接收，避免 any 顺着判断流进调用方。
 */
export function isArrayValue(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/**
 * 值既不是 null 也不是 undefined —— jsonl 的缺失字段两种形态都会出现。
 *
 * 写成类型谓词而不是普通布尔判断：调用方 `if (!isPresent(x)) return` 之后
 * TS 能把 x 窄化回非空类型，省掉每个调用点重复一遍的 `x !== null` 噪音。
 */
export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

/** 读取字符串；非字符串（含 null / undefined / 数字）一律按空串处理 */
export function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 读取"非空才算有"的字符串。
 *
 * uuid、工具名这类键空串等同于没有：返回 null 让调用方走"无键"分支，
 * 而不是把空串当成一个合法分组。
 */
export function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 读取可参与运算的正数。
 *
 * NaN / Infinity / 负数 / 非数字一律按 0 计：token 数、结果体积这类量
 * 在真实计费里不可能为负，保留脏值只会让汇总出现无法解释的数字。
 */
export function readPositiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** 读取任意有限数（时区偏移、成本这类可正可负的量）；非有限数返回 null */
export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
