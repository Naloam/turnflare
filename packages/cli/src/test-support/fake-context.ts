/**
 * 测试替身：把 stdout / stderr 收进数组的假 context。
 *
 * 放在 `src/test-support/` 而不是 `*.test.ts` 里，是为了让多个测试文件共用；
 * 与 api 包一样，这个目录会被 tsconfig 一并编译进 dist，运行时没有任何生产
 * 路径引用它。
 */
import type { CliContext } from '../context.js'

export interface RecordingContextOptions {
  readonly args?: readonly string[]
  /**
   * 默认就是 `{ TURNFLARE_DB: ':memory:' }`。
   *
   * 不是图省事：不显式给数据库路径时，命令会去读开发者真实的
   * `~/.turnflare/turnflare.db`——测试绝不能碰用户的真实数据。
   */
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
}

export interface RecordingContext {
  readonly ctx: CliContext
  readonly stdoutLines: readonly string[]
  readonly stderrLines: readonly string[]
  readonly stdoutText: () => string
  readonly stderrText: () => string
}

/** 造一个可断言输出的内存 context */
export function createRecordingContext(options?: RecordingContextOptions): RecordingContext {
  const stdoutLines: string[] = []
  const stderrLines: string[] = []

  const ctx: CliContext = {
    args: options?.args ?? [],
    stdout: (text) => {
      stdoutLines.push(text)
    },
    stderr: (text) => {
      stderrLines.push(text)
    },
    env: options?.env ?? { TURNFLARE_DB: ':memory:' },
    cwd: options?.cwd ?? process.cwd(),
  }

  return {
    ctx,
    stdoutLines,
    stderrLines,
    stdoutText: () => stdoutLines.join(''),
    stderrText: () => stderrLines.join(''),
  }
}
