import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestDeps } from '../test-support/fixtures.js'
import { parseJsonObject } from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'

const harness = useHarness()

describe('turnflare scan', () => {
  it('成功路径：扫描夹具并打印汇总', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['scan', '--root', fixtureRoot])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain(`扫描根目录：${fixtureRoot}`)
    // 夹具：2 个真会话 + 1 个插件遥测 + 1 个空文件
    expect(outcome.stdout).toContain('已扫描 2 个会话')
    expect(outcome.stdout).toContain('跳过 2 个非会话文件')
    expect(outcome.stdout).toContain('跳过 0 个未变化文件')
  })

  it('成功路径：第二次扫描全部走增量跳过', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()
    await harness.run(['scan', '--root', fixtureRoot])

    // Act
    const outcome = await harness.run(['scan', '--root', fixtureRoot])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('已扫描 0 个会话')
    expect(outcome.stdout).toContain('跳过 2 个未变化文件')
  })

  it('成功路径：--json 输出机器可读结果且不带进度条', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['scan', '--root', fixtureRoot, '--json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(payload).toMatchObject({
      rootDir: fixtureRoot,
      totalFiles: 4,
      scannedFiles: 2,
      skippedEmpty: 2,
      skippedFiles: 0,
      failedFiles: 0,
    })
    expect(payload.failures).toEqual([])
  })

  it('成功路径：内存数据库也能扫（测试与 CI 的默认姿势）', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['scan', '--root', fixtureRoot], {
      env: { TURNFLARE_DB: ':memory:' },
    })

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('已扫描 2 个会话')
  })

  it('参数错误：--since 不是合法时间', async () => {
    const outcome = await harness.run(['scan', '--since', '昨天'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--since 不是合法的时间字符串')
    expect(outcome.stderr).toContain('用法：turnflare scan')
  })

  it('参数错误：未知选项', async () => {
    const outcome = await harness.run(['scan', '--nope'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('未知选项：--nope')
  })

  it('运行时错误：扫描根目录不存在', async () => {
    // Arrange
    const missing = `${harness.state().fixtureRoot}-does-not-exist`

    // Act
    const outcome = await harness.run(['scan', '--root', missing])

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('扫描根目录不存在')
    expect(outcome.stderr).toContain('错误：')
  })

  it('成功路径：单个文件读不了只记失败，不影响整次扫描', async () => {
    // Arrange：塞一个没有读权限的会话文件
    const { fixtureRoot } = harness.state()
    const locked = join(fixtureRoot, '-Users-che1sy-Projects-beta', 'locked.jsonl')
    mkdirSync(join(fixtureRoot, '-Users-che1sy-Projects-beta'), { recursive: true })
    writeFileSync(locked, '{"type":"user"}\n', 'utf8')
    chmodSync(locked, 0o000)

    try {
      // Act
      const outcome = await harness.run(['scan', '--root', fixtureRoot])

      // Assert：扫描整体仍然成功，失败文件单独报出来
      expect(outcome.exitCode).toBe(0)
      expect(outcome.stdout).toContain('已扫描 2 个会话')
      expect(outcome.stdout).toContain('失败 1 个文件')
      expect(outcome.stderr).toContain('扫描失败：')
    } finally {
      chmodSync(locked, 0o600)
    }
  })

  it('运行时错误：进度上报抛异常时命令收敛成 exitCode 1', async () => {
    // Arrange：让进度回调炸掉，模拟渲染层故障
    const base = createTestDeps()
    const deps = {
      ...base,
      deps: {
        ...base.deps,
        createProgress: () => ({
          advance: () => {
            throw new Error('进度条崩了')
          },
          stop: () => undefined,
        }),
      },
    }

    // Act
    const outcome = await harness.run(['scan', '--root', harness.state().fixtureRoot], { deps })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('扫描失败')
    expect(outcome.stderr).toContain('进度条崩了')
  })

  it('运行时错误：根目录是个文件而不是目录', async () => {
    // Arrange
    const { dbPath } = harness.state()

    // Act
    const outcome = await harness.run(['scan', '--root', dbPath])

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('扫描根目录不是目录')
  })
})
