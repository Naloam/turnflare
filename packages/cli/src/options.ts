/**
 * 命令与选项的类型契约。
 *
 * `argv.ts` 负责把字符串数组解析成这些形状；命令实现只消费这些形状，
 * 于是"参数怎么拼"与"命令做什么"可以分别测试。
 *
 * 可选值一律显式写成 `T | undefined` 而不是 `?: T`：`exactOptionalPropertyTypes`
 * 下，`{ root: undefined }` 不能赋给 `root?: string`，显式联合让解析器可以
 * 无条件构造对象，再由使用方在边界上决定要不要省略这个键。
 */

/** 全部子命令名 */
export type CommandName = 'scan' | 'stats' | 'sessions' | 'session' | 'report' | 'models' | 'serve'

/** 命令顺序即帮助里的展示顺序 */
export const COMMAND_NAMES: readonly CommandName[] = [
  'scan',
  'stats',
  'sessions',
  'session',
  'report',
  'models',
  'serve',
]

/** 会话列表排序键，与仓储的 `SessionsQuery.sort` 对齐 */
export type SortKey = 'cost' | 'tokens' | 'recent' | 'turns'

export const SORT_KEYS: readonly SortKey[] = ['cost', 'tokens', 'recent', 'turns']

/** stats 的人类可读格式；`--json` 走全局开关，不占这个枚举 */
export type StatsFormat = 'table' | 'markdown'

export const STATS_FORMATS: readonly StatsFormat[] = ['table', 'markdown']

/** report 的输出格式，与 core 的 `ReportFormat` 一致 */
export type ReportFormatName = 'html' | 'markdown' | 'csv' | 'json'

export const REPORT_FORMATS: readonly ReportFormatName[] = ['html', 'markdown', 'csv', 'json']

/**
 * 每个命令的选项都带 `json`。
 *
 * 全局开关放在选项里而不是单独一路传递：命令签名只有 `(ctx, options)` 两个
 * 参数（见 `Command`），把全局状态塞进 context 会让"输出什么格式"这件事
 * 散落两处。
 */
export interface ScanOptions {
  readonly json: boolean
  readonly root: string | undefined
  /** `--project` 可重复；空数组表示不过滤 */
  readonly projects: readonly string[]
  readonly since: string | undefined
  readonly force: boolean
}

export interface StatsOptions {
  readonly json: boolean
  /** 统计窗口天数；undefined 表示全量 */
  readonly days: number | undefined
  readonly format: StatsFormat
}

export interface SessionsOptions {
  readonly json: boolean
  readonly limit: number
  readonly project: string | undefined
  readonly sort: SortKey
}

export interface SessionOptions {
  readonly json: boolean
  readonly id: string
}

export interface ReportOptions {
  readonly json: boolean
  readonly format: ReportFormatName
  readonly out: string | undefined
}

/** models 只有全局 `--json` 一个开关 */
export interface ModelsOptions {
  readonly json: boolean
}

export interface ServeOptions {
  readonly json: boolean
  /** undefined 表示没传 `--port`，沿用 api 配置（PORT 环境变量或默认端口） */
  readonly port: number | undefined
}

/**
 * 解析成功的一次调用。
 *
 * 写成可判别联合而不是 `{ command; options: 联合 }`：分发层的
 * `switch (invocation.command)` 只有在前者下才能把 `options` 窄化成
 * 具体命令的选项类型，省掉一次强制断言。
 */
export type Invocation =
  | { readonly command: 'scan'; readonly options: ScanOptions }
  | { readonly command: 'stats'; readonly options: StatsOptions }
  | { readonly command: 'sessions'; readonly options: SessionsOptions }
  | { readonly command: 'session'; readonly options: SessionOptions }
  | { readonly command: 'report'; readonly options: ReportOptions }
  | { readonly command: 'models'; readonly options: ModelsOptions }
  | { readonly command: 'serve'; readonly options: ServeOptions }

/** 会话列表默认条数 */
export const DEFAULT_SESSION_LIMIT = 20

/**
 * 会话列表单页条数上限，与 api 仓储 `normalizeSessionsQuery` 的夹取口径一致。
 *
 * 仓储会把更大的值静默夹到 200，CLI 因此在这里先失败：传 `--limit 500` 的人
 * 应当立刻知道上限是 200，而不是拿着 200 条却以为拿到了全部。
 */
export const MAX_SESSION_LIMIT = 200

/** serve 默认端口，与 api 包保持一致 */
export const DEFAULT_SERVE_PORT = 8787

/** 单会话详情默认展示的轮次数 */
export const SESSION_TURN_PREVIEW_LIMIT = 50

/** 列表里会话 ID 的展示长度 */
export const SESSION_ID_DISPLAY_LENGTH = 8
