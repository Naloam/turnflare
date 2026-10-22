import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  parseJsonObject,
  readArrayField,
  readNumberField,
  readStringField,
} from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'

const harness = useHarness()

describe('turnflare session', () => {
  it('成功路径：前缀匹配渲染元信息、轮次与工具统计', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'sess-alp'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('会话 sess-alp')
    expect(outcome.stdout).toContain('-Users-che1sy-Projects-alpha')
    expect(outcome.stdout).toContain('/Users/che1sy/Projects/alpha')
    expect(outcome.stdout).toContain('main')
    expect(outcome.stdout).toContain('对话轮次')
    expect(outcome.stdout).toContain('工具统计')
    expect(outcome.stdout).toContain('Read')
    // 轮次预览：第 1 条是用户消息
    expect(outcome.stdout).toContain('帮我看看这个项目')
  })

  it('成功路径：完整 ID 也能找到', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'sess-alpha-1'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('会话 sess-alp')
  })

  it('成功路径：--json 输出会话详情', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'sess-alp', '--json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(readStringField(payload, 'sessionId')).toBe('sess-alpha-1')
    expect(readArrayField(payload, 'turns').length).toBeGreaterThan(0)
    expect(readNumberField(payload, 'parseErrorCount')).toBe(0)
  })

  it('成功路径：工具结果没有正文时给占位符而不是空格', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'sess-alp'])

    // Assert
    expect(outcome.stdout).toContain('（无文本内容）')
  })

  it('前缀匹配到多场会话时报歧义', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'sess-'])

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('匹配到 2 场会话')
  })

  it('找不到会话时报错', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['session', 'nope-nope'])

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('找不到会话')
  })

  it('参数错误：缺少 id', async () => {
    const outcome = await harness.run(['session'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('缺少参数：<id>')
  })

  it('参数错误：多余的位置参数', async () => {
    const outcome = await harness.run(['session', 'a', 'b'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('多余的位置参数')
  })

  it('运行时错误：数据库文件不存在', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['session', 'sess-alp'], {
      env: { TURNFLARE_DB: join(fixtureRoot, 'missing.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('数据库不存在')
  })
})
