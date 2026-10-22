import { describe, expect, it } from 'vitest'
import { runCli } from './cli.js'
import { COMMAND_NAMES } from './options.js'
import { createTestDeps } from './test-support/fixtures.js'
import { createRecordingContext } from './test-support/fake-context.js'
import { useHarness } from './test-support/harness.js'

const harness = useHarness()

/** 不走 harness 的 env，直接给一个内存库，避免碰真实数据 */
function memoryRun(args: readonly string[]) {
  const testDeps = createTestDeps()
  const recording = createRecordingContext({ args, env: { TURNFLARE_DB: ':memory:' } })
  return runCli(recording.ctx, testDeps.deps).then((result) => ({
    exitCode: result.exitCode,
    message: result.message,
    stdout: recording.stdoutText(),
    stderr: recording.stderrText(),
  }))
}

describe('runCli：分发层', () => {
  it('--help 走 stdout 并列出全部命令', async () => {
    const outcome = await memoryRun(['--help'])
    expect(outcome.exitCode).toBe(0)
    for (const name of COMMAND_NAMES) {
      expect(outcome.stdout).toContain(name)
    }
    expect(outcome.stderr).toBe('')
  })

  it('命令级 --help 给该命令的用法', async () => {
    const outcome = await memoryRun(['scan', '--help'])
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('turnflare scan')
    expect(outcome.stdout).toContain('--root DIR')
  })

  it('--version 输出版本号', async () => {
    const outcome = await memoryRun(['--version'])
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toMatch(/^turnflare \d+\.\d+\.\d+\n$/)
  })

  it('未知命令 exitCode 2 且用法提示进 stderr', async () => {
    const outcome = await memoryRun(['frobnicate'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('未知命令：frobnicate')
    expect(outcome.stderr).toContain('用法：')
    expect(outcome.stdout).toBe('')
  })

  it('空参数 exitCode 2', async () => {
    const outcome = await memoryRun([])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('缺少命令')
  })

  it('命令失败时 message 带上"错误："前缀进 stderr', async () => {
    // Arrange：指向一个不存在的库文件
    const { fixtureRoot } = harness.state()
    const recording = createRecordingContext({
      args: ['stats'],
      env: { TURNFLARE_DB: `${fixtureRoot}/missing.db` },
    })

    // Act
    const result = await runCli(recording.ctx, createTestDeps().deps)

    // Assert
    expect(result.exitCode).toBe(1)
    expect(recording.stderrText()).toContain('错误：数据库不存在')
    expect(recording.stdoutText()).toBe('')
  })

  it('成功命令不往 stderr 写任何东西', async () => {
    const outcome = await memoryRun(['models'])
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stderr).toBe('')
  })
})
