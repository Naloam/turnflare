import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { parseJsonObject, readObjectField } from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'

const harness = useHarness()

describe('turnflare models', () => {
  it('成功路径：打印标准价目表与 fast 价目表', async () => {
    // Act
    const outcome = await harness.run(['models'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('模型价目表')
    expect(outcome.stdout).toContain('claude-opus-5-5')
    expect(outcome.stdout).toContain('$4.00')
    expect(outcome.stdout).toContain('fast 模式价目')
    // 缓存列的说明不能丢：用户需要知道 1h 缓存写怎么算
    expect(outcome.stdout).toContain('1 小时 TTL 价')
  })

  it('成功路径：--json 输出原始价目对象', async () => {
    // Act
    const outcome = await harness.run(['models', '--json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(readObjectField(payload, 'models')['claude-opus-5-5']).toEqual({
      input: 4,
      output: 20,
      cacheWrite: 5,
      cacheRead: 0.2,
    })
    expect(Object.keys(readObjectField(payload, 'fast'))).toContain('claude-opus-5-5')
  })

  it('不依赖数据库：没有库文件时照样能查价目', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['models'], {
      env: { TURNFLARE_DB: join(fixtureRoot, 'missing.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('模型价目表')
  })

  it('参数错误：未知选项', async () => {
    const outcome = await harness.run(['models', '--nope'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('未知选项：--nope')
  })

  it('参数错误：不接受位置参数', async () => {
    const outcome = await harness.run(['models', 'claude-opus-5'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('多余的位置参数')
  })
})
