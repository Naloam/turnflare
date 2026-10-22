import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { runCli } from '../cli.js'
import { createTestDeps } from '../test-support/fixtures.js'
import { createRecordingContext } from '../test-support/fake-context.js'
import { parseJsonObject, readStringField } from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'

const harness = useHarness()

describe('turnflare serve', () => {
  it('成功路径：打印监听地址与数据根目录，收到信号后优雅退出', async () => {
    // Arrange
    const testDeps = createTestDeps()

    // Act：先发起调用，再模拟 SIGINT
    const pending = harness.run(['serve', '--port', '9000'], { deps: testDeps })
    testDeps.serve.triggerShutdown()
    const outcome = await pending

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('Turnflare API 已启动')
    expect(outcome.stdout).toContain('http://127.0.0.1:9000')
    expect(outcome.stdout).toContain('.claude/projects')
    expect(outcome.stdout).toContain(harness.state().dbPath)
    expect(testDeps.serve.listenCalls).toEqual([{ port: 9000, host: '127.0.0.1' }])
    expect(testDeps.serve.closeCount()).toBe(1)
    expect(outcome.stderr).toContain('服务已停止')
  })

  it('成功路径：--json 输出结构化监听信息', async () => {
    // Arrange
    const testDeps = createTestDeps()

    // Act
    const pending = harness.run(['serve', '--port', '9001', '--json'], { deps: testDeps })
    testDeps.serve.triggerShutdown()
    const outcome = await pending

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(readStringField(payload, 'url')).toBe('http://127.0.0.1:9001')
    expect(readStringField(payload, 'dbPath')).toBe(harness.state().dbPath)
  })

  it('成功路径：--port 缺禁时沿用 PORT 环境变量', async () => {
    // Arrange
    const testDeps = createTestDeps()

    // Act
    const pending = harness.run(['serve'], {
      deps: testDeps,
      env: { TURNFLARE_DB: ':memory:', PORT: '9100' },
    })
    testDeps.serve.triggerShutdown()
    const outcome = await pending

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(testDeps.serve.listenCalls).toEqual([{ port: 9100, host: '127.0.0.1' }])
  })

  it('成功路径：--port 优先于 PORT 环境变量', async () => {
    // Arrange
    const testDeps = createTestDeps()

    // Act
    const pending = harness.run(['serve', '--port', '9200'], {
      deps: testDeps,
      env: { TURNFLARE_DB: ':memory:', PORT: '9100' },
    })
    testDeps.serve.triggerShutdown()
    await pending

    // Assert
    expect(testDeps.serve.listenCalls).toEqual([{ port: 9200, host: '127.0.0.1' }])
  })

  it('参数错误：--port 越界', async () => {
    const outcome = await harness.run(['serve', '--port', '99999'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--port 必须是 1-65535 的整数')
  })

  it('运行时错误：监听失败', async () => {
    // Arrange
    const base = createTestDeps()
    const deps = {
      ...base,
      deps: {
        ...base.deps,
        listen: () => Promise.reject(new Error('端口被占用')),
      },
    }
    const recording = createRecordingContext({
      args: ['serve', '--port', '9300'],
      env: { TURNFLARE_DB: ':memory:' },
    })

    // Act
    const result = await runCli(recording.ctx, deps.deps)

    // Assert
    expect(result.exitCode).toBe(1)
    expect(result.message).toContain('启动服务失败')
    expect(recording.stderrText()).toContain('端口被占用')
  })

  it('运行时错误：数据库路径不可用', async () => {
    // Arrange：把库指到一个文件下面的路径，mkdirSync 必然失败
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['serve'], {
      env: { TURNFLARE_DB: join(fixtureRoot, '-Users-che1sy-Projects-alpha', 'a.jsonl', 'x.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('无法打开数据库')
  })
})
