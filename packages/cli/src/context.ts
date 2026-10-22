/**
 * 命令执行的上下文与返回值。
 *
 * 这里是整个 CLI 唯一与"外界"接触的形状：所有命令实现只通过 `CliContext`
 * 读写输出与环境，不直接碰 `process.stdout` / `process.exit`。可测试性来自
 * 这条约束——测试只要造一个把 stdout/stderr 收进数组的假 context，
 * 就能断言任何命令的完整输出。
 */

/** 退出码：0 成功 / 1 运行时错误 / 2 参数错误 */
export type ExitCode = 0 | 1 | 2

/** 一次命令执行可用的全部外部能力 */
export interface CliContext {
  /** 原始参数（不含 node 与脚本路径），供需要回看的命令使用 */
  readonly args: readonly string[]
  /** 标准输出：人类可读结果与 --json 的机器可读结果都走这里 */
  readonly stdout: (text: string) => void
  /** 标准错误：诊断细节与失败原因走这里，绝不混进 stdout */
  readonly stderr: (text: string) => void
  /** 进程环境（测试可整体替换，避免读到开发者真实配置） */
  readonly env: NodeJS.ProcessEnv
  /** 当前工作目录 */
  readonly cwd: string
}

/** 命令执行结果；`message` 由分发层写到 stderr，命令自己不重复打印 */
export interface CommandResult {
  readonly exitCode: ExitCode
  readonly message?: string
}

/** 一个子命令：元信息 + 可注入依赖的纯执行体 */
export interface Command<TOptions> {
  readonly name: string
  readonly description: string
  /** 用法行，例如 `turnflare scan [--root DIR]` */
  readonly usage: string
  /**
   * 执行体。允许返回 CommandResult 或 Promise<CommandResult>：
   * models 这类纯本地命令没有任何可 await 的东西，强迫它们挂上 async 只会
   * 得到一个空的 async 函数（require-await 会报），而分发层统一 await 两种
   * 返回值都成立。
   */
  readonly run: (ctx: CliContext, options: TOptions) => CommandResult | Promise<CommandResult>
}

/** 成功结果；冻结避免被调用方误改 */
export const SUCCESS: CommandResult = Object.freeze({ exitCode: 0 })

/**
 * 构造失败结果。
 *
 * 1 与 2 分开而不是合成一个 `ok: false`：退出码是 CLI 与 shell 的契约，
 * 脚本要靠它区分"参数写错了"（重试也没用）和"环境出问题了"（可能可以重试）。
 */
export function failure(exitCode: 1 | 2, message: string): CommandResult {
  return { exitCode, message }
}
