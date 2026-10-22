import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseJsonObject,
  readNumberField,
  readRecordArray,
  readStringField,
} from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'
import { createBulkSessionRoot, removeFixtureRoot } from '../test-support/fixtures.js'
import { MAX_SESSION_LIMIT } from '../options.js'

const harness = useHarness()

/**
 * 比 `--limit` 上限多一场。
 *
 * 必须超过上限："还有更多"只在 shown < total 时出现，而 limit 又必须正好等于
 * 上限才能复现"触顶"——两个条件只有 total = 上限 + 1 能同时满足。
 */
const OVER_CAP_SESSION_COUNT = MAX_SESSION_LIMIT + 1

describe('turnflare sessions', () => {
  it('成功路径：渲染会话表格', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('共 2 场会话')
    expect(outcome.stdout).toContain('sess-alp')
    expect(outcome.stdout).toContain('sess-bet')
    expect(outcome.stdout).toContain('-Users-che1sy-Projects-alpha')
    expect(outcome.stdout).toContain('claude-opus-5-5')
  })

  it('成功路径：--json 输出结构化列表', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions', '--json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(readNumberField(payload, 'total')).toBe(2)
    const items = readRecordArray(payload, 'items')
    expect(items).toHaveLength(2)
    expect(items.map((item) => readStringField(item, 'sessionId'))).toContain('sess-alpha-1')
  })

  it('成功路径：--limit 截断并提示还有更多', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions', '--limit', '1'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('显示前 1 场，可用 --limit 调整')
    expect(outcome.stdout).not.toContain('sess-bet')
  })

  it('成功路径：--limit 触顶时改说上限，不再建议调大', async () => {
    // Arrange：会话数刚好超过 argv 允许的上限，limit 已经无处可调
    const bulkRoot = createBulkSessionRoot(OVER_CAP_SESSION_COUNT)
    try {
      await harness.run(['scan', '--root', bulkRoot])

      // Act
      const outcome = await harness.run(['sessions', '--limit', String(MAX_SESSION_LIMIT)])

      // Assert
      expect(outcome.exitCode).toBe(0)
      expect(outcome.stdout).toContain(`共 ${String(OVER_CAP_SESSION_COUNT)} 场会话`)
      expect(outcome.stdout).toContain(`已达单页上限 ${String(MAX_SESSION_LIMIT)}`)
      // 这句建议在触顶时必然失败：argv 会拒绝 --limit 201
      expect(outcome.stdout).not.toContain('可用 --limit 调整')
    } finally {
      removeFixtureRoot(bulkRoot)
    }
  })

  it('成功路径：--project 只显示指定项目', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions', '--project', '-Users-che1sy-Projects-beta'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('共 1 场会话')
    expect(outcome.stdout).toContain('sess-bet')
    expect(outcome.stdout).not.toContain('sess-alp')
  })

  it('成功路径：--sort 接受全部排序键', async () => {
    // Arrange
    await harness.seed()

    // Act / Assert
    for (const sort of ['cost', 'tokens', 'recent', 'turns']) {
      const outcome = await harness.run(['sessions', '--sort', sort])
      expect(outcome.exitCode).toBe(0)
      expect(outcome.stdout).toContain('共 2 场会话')
    }
  })

  it('成功路径：空数据库给友好提示', async () => {
    // Arrange：扫一个空目录，只会建库不会写入会话
    const emptyRoot = mkdtempSync(join(tmpdir(), 'turnflare-cli-empty-'))
    try {
      await harness.run(['scan', '--root', emptyRoot])

      // Act
      const outcome = await harness.run(['sessions'])

      // Assert
      expect(outcome.exitCode).toBe(0)
      expect(outcome.stdout).toContain('暂无会话数据')
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })

  it('参数错误：--limit 不是正整数', async () => {
    const outcome = await harness.run(['sessions', '--limit', 'abc'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--limit 必须是正整数')
  })

  it('参数错误：--limit 超出上限时直接失败，而不是静默截断', async () => {
    // Arrange：仓储会把超限值夹到 200，CLI 必须先拒绝，否则用户以为拿到了全部
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions', '--limit', '500'])

    // Assert
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--limit 不能超过 200')
    expect(outcome.stdout).toBe('')
  })

  it('成功路径：--limit 正好等于上限时放行', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['sessions', '--limit', '200'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('共 2 场会话')
  })

  it('参数错误：--sort 不在枚举内', async () => {
    const outcome = await harness.run(['sessions', '--sort', 'size'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--sort 只支持')
  })

  it('运行时错误：数据库文件不存在', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['sessions'], {
      env: { TURNFLARE_DB: join(fixtureRoot, 'missing.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('数据库不存在')
  })
})
