import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { parseJsonObject, readNumberField, readStringField } from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'

const harness = useHarness()

describe('turnflare report', () => {
  it('成功路径：HTML 打到 stdout 且是自包含文档', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['report', '--format', 'html'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('<!doctype html>')
    expect(outcome.stdout).toContain('Turnflare')
  })

  it('成功路径：--out 写文件并打印绝对路径与体积', async () => {
    // Arrange
    await harness.seed()
    const { cwd } = harness.state()

    // Act
    const outcome = await harness.run(['report', '--format', 'markdown', '--out', 'report.md'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.writes).toHaveLength(1)
    const written = outcome.writes[0]
    expect(written).toBeDefined()
    if (written !== undefined) {
      expect(written.path).toBe(join(cwd, 'report.md'))
      expect(written.content).toContain('Turnflare')
    }
    expect(outcome.stdout).toContain('已写入')
    expect(outcome.stdout).toContain(join(cwd, 'report.md'))
  })

  it('成功路径：--json --out 时确认信息也是 JSON', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['report', '--json', '--out', '/tmp/tl-report.json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    expect(readStringField(payload, 'path')).toBe('/tmp/tl-report.json')
    expect(readStringField(payload, 'format')).toBe('json')
    expect(readNumberField(payload, 'bytes')).toBeGreaterThan(0)
    expect(outcome.writes[0]?.path).toBe('/tmp/tl-report.json')
  })

  it('成功路径：CSV 打到 stdout', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['report', '--format', 'csv'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('模型分布')
    expect(outcome.stdout).toContain('claude-opus-5-5')
  })

  it('成功路径：默认格式是 html', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['report'])

    // Assert
    expect(outcome.stdout).toContain('<!doctype html>')
  })

  it('参数错误：--format 不在枚举内', async () => {
    const outcome = await harness.run(['report', '--format', 'pdf'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--format 只支持')
  })

  it('运行时错误：数据库文件不存在', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['report'], {
      env: { TURNFLARE_DB: join(fixtureRoot, 'missing.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('数据库不存在')
  })
})
