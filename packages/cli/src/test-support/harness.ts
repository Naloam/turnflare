/**
 * 测试替身：CLI 集成测试的骨架。
 *
 * 每个测试文件调用一次 `useHarness()`，就得到：
 *   - 一个全新的临时数据库文件（绝不碰用户真实的 ~/.turnflare/turnflare.db）；
 *   - 一个全新的会话夹具目录；
 *   - 一个 `run(args)`：走**真实**的 `runCli` 分发路径，只把进度条、
 *     写文件、serve 的监听与退出信号换成可断言的替身。
 *
 * 这样每条命令的"成功 / 参数错误 / 运行时错误"都能按用户真实键入的顺序验证。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { runCli } from '../cli.js'
import { createTestDeps, removeFixtureRoot, writeSessionFixture } from './fixtures.js'
import type { TestDeps } from './fixtures.js'
import { createRecordingContext } from './fake-context.js'

export interface RunOutcome {
  readonly exitCode: 0 | 1 | 2
  readonly message: string | undefined
  readonly stdout: string
  readonly stderr: string
  /** `report --out` 写出去的内容 */
  readonly writes: TestDeps['writes']
  /** serve 的探针：监听参数、关闭次数、模拟信号 */
  readonly serve: TestDeps['serve']
}

export interface HarnessState {
  /** 传给 context 的环境变量；只有 TURNFLARE_DB，避免读到开发者真实配置 */
  readonly env: NodeJS.ProcessEnv
  readonly dbPath: string
  readonly fixtureRoot: string
  /** 传给 context 的工作目录；`--out` 相对路径按它解析 */
  readonly cwd: string
}

export interface RunOptions {
  /** 覆盖依赖；默认每跑一次换一套新的替身 */
  readonly deps?: TestDeps
  /** 覆盖环境变量；用来把数据库指到 :memory: */
  readonly env?: NodeJS.ProcessEnv
}

export interface Harness {
  /** 当前测试的状态；只在测试体内调用 */
  readonly state: () => HarnessState
  /** 把夹具扫进库，供读类命令使用 */
  readonly seed: () => Promise<RunOutcome>
  /** 跑一次完整 CLI 调用 */
  readonly run: (args: readonly string[], options?: RunOptions) => Promise<RunOutcome>
}

/** 注册 beforeEach / afterEach 并返回骨架 */
export function useHarness(): Harness {
  let current: { readonly state: HarnessState; readonly cleanup: () => void } | null = null

  const state = (): HarnessState => {
    if (current === null) {
      throw new Error('harness 尚未初始化：只能在测试体内调用')
    }
    return current.state
  }

  beforeEach(() => {
    const workDir = mkdtempSync(join(tmpdir(), 'turnflare-cli-work-'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'turnflare-cli-fixture-'))
    writeSessionFixture(fixtureRoot)
    current = {
      state: {
        env: { TURNFLARE_DB: join(workDir, 'turnflare.db') },
        dbPath: join(workDir, 'turnflare.db'),
        fixtureRoot,
        cwd: process.cwd(),
      },
      cleanup: () => {
        rmSync(workDir, { recursive: true, force: true })
        removeFixtureRoot(fixtureRoot)
      },
    }
  })

  afterEach(() => {
    current?.cleanup()
    current = null
  })

  const run = async (args: readonly string[], options?: RunOptions): Promise<RunOutcome> => {
    const deps = options?.deps ?? createTestDeps()
    const recording = createRecordingContext({ args, env: options?.env ?? state().env })
    const result = await runCli(recording.ctx, deps.deps)
    return {
      exitCode: result.exitCode,
      message: result.message,
      stdout: recording.stdoutText(),
      stderr: recording.stderrText(),
      writes: deps.writes,
      serve: deps.serve,
    }
  }

  return {
    state,
    seed: () => run(['scan', '--root', state().fixtureRoot]),
    run,
  }
}
