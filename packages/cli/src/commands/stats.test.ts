import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseJsonObject,
  readNumberField,
  readObjectField,
  readRecordArray,
  readStringField,
} from '../test-support/json.js'
import { useHarness } from '../test-support/harness.js'
import {
  UNPRICED_MODEL,
  createSidechainFixtureRoot,
  removeFixtureRoot,
} from '../test-support/fixtures.js'

const harness = useHarness()

/** 一个空目录：扫它只会建库，不会写入任何会话 */
function createEmptyRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'turnflare-cli-empty-'))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('turnflare stats', () => {
  it('成功路径：渲染总览 + 模型分布 + Top 工具', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('Turnflare 统计')
    expect(outcome.stdout).toContain('会话数')
    expect(outcome.stdout).toContain('模型分布')
    expect(outcome.stdout).toContain('Top 工具')
    // 夹具里 2 场会话
    expect(outcome.stdout).toContain('│ 2 ')
    expect(outcome.stdout).toContain('claude-opus-5-5')
    expect(outcome.stdout).toContain('Read')
  })

  it('成功路径：有无价目模型时输出醒目警告', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats'])

    // Assert
    expect(outcome.stdout).toContain('部分模型无价目数据')
    expect(outcome.stdout).toContain(UNPRICED_MODEL)
  })

  it('成功路径：--json 输出结构化统计', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--json'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    const payload = parseJsonObject(outcome.stdout)
    const overview = readObjectField(payload, 'overview')
    expect(readNumberField(overview, 'sessionCount')).toBe(2)
    const models = readRecordArray(overview, 'byModel')
    expect(models.map((model) => readStringField(model, 'model'))).toContain('claude-opus-5-5')
    // 没给 --days 时没有窗口
    expect(payload.window).toBeNull()
  })

  it('成功路径：--days 给出窗口行并把分布表标注为全量口径', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--days', '7'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('最近 7 天')
    expect(outcome.stdout).toContain('模型分布（全量口径）')
    expect(outcome.stdout).toContain('Top 工具（全量口径）')
  })

  it('成功路径：--days 的窗口也出现在 JSON 里', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--days', '7', '--json'])

    // Assert
    const payload = parseJsonObject(outcome.stdout)
    const window = readObjectField(payload, 'window')
    expect(readNumberField(window, 'days')).toBe(7)
  })

  it('成功路径：--format markdown 输出管道表', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--format', 'markdown'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('# Turnflare 统计')
    expect(outcome.stdout).toContain('| 指标 | 数值 |')
    expect(outcome.stdout).toContain('## 模型分布')
  })

  it('成功路径：空数据库给友好提示而不是一堆 0', async () => {
    // Arrange
    const emptyRoot = createEmptyRoot()
    try {
      await harness.run(['scan', '--root', emptyRoot])

      // Act
      const outcome = await harness.run(['stats'])

      // Assert
      expect(outcome.exitCode).toBe(0)
      expect(outcome.stdout).toContain('暂无会话数据')
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })

  it('参数错误：--days 不是正整数', async () => {
    const outcome = await harness.run(['stats', '--days', 'abc'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--days 必须是正整数')
  })

  it('参数错误：--format 不在枚举内', async () => {
    const outcome = await harness.run(['stats', '--format', 'xml'])
    expect(outcome.exitCode).toBe(2)
    expect(outcome.stderr).toContain('--format 只支持')
  })

  it('运行时错误：数据库文件不存在', async () => {
    // Arrange
    const { fixtureRoot } = harness.state()

    // Act
    const outcome = await harness.run(['stats'], {
      env: { TURNFLARE_DB: join(fixtureRoot, 'missing.db') },
    })

    // Assert
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('数据库不存在')
  })
})

describe('stats 的 --days 窗口对 markdown 也生效', () => {
  it('markdown 输出包含窗口汇总行与全量口径标注', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--days', '7', '--format', 'markdown'])

    // Assert：markdown 与人类表格必须呈现同一套窗口信息，
    // 否则存进文件的报表会被读者当成"没有窗口过滤"。
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('最近 7 天：')
    expect(outcome.stdout).toContain('模型分布（全量口径）')
    expect(outcome.stdout).toContain('Top 工具（全量口径）')
  })

  it('不带 --days 时 markdown 不含窗口行与口径标注', async () => {
    // Arrange
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats', '--format', 'markdown'])

    // Assert
    expect(outcome.stdout).not.toContain('最近 ')
    expect(outcome.stdout).not.toContain('（全量口径）')
  })
})

describe('stats 的 subagent 活动', () => {
  /**
   * 只扫带侧链的夹具（不调 harness.seed()）：默认夹具没有侧链 turn，
   * 混在一起扫会让"有没有侧链"这个前提变得不可控。
   */
  async function seedSidechain(): Promise<void> {
    const root = createSidechainFixtureRoot()
    try {
      await harness.run(['scan', '--root', root])
    } finally {
      removeFixtureRoot(root)
    }
  }

  it('有侧链活动时总览表展示 subagent 行与口径说明', async () => {
    // Arrange：夹具里 3 条侧链 turn（1 条 user + 2 条计费 assistant），共 7,200 token
    await seedSidechain()

    // Act
    const outcome = await harness.run(['stats'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('subagent 活动')
    expect(outcome.stdout).toContain('3 turn')
    expect(outcome.stdout).toContain('7.2K token')
    expect(outcome.stdout).toContain('2 次计费请求')
    // 口径说明必须跟着出现，否则用户会把总览当成全部用量
    expect(outcome.stdout).toContain('上方总览为主对话口径，不含 subagent 活动')
  })

  it('markdown 与人类表格呈现同一套 subagent 信息', async () => {
    // Arrange：markdown 是要存进文件/贴进 issue 的，少一行就会被当成"没有侧链活动"
    await seedSidechain()

    // Act
    const outcome = await harness.run(['stats', '--format', 'markdown'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toContain('| subagent 活动 | 3 turn')
    expect(outcome.stdout).toContain('7.2K token')
    expect(outcome.stdout).toContain('2 次计费请求')
    expect(outcome.stdout).toContain('> 上方总览为主对话口径，不含 subagent 活动')
  })

  it('--json 把 sidechain 汇总原样带上', async () => {
    // Arrange
    await seedSidechain()

    // Act
    const outcome = await harness.run(['stats', '--json'])

    // Assert
    const payload = parseJsonObject(outcome.stdout)
    const sidechain = readObjectField(readObjectField(payload, 'overview'), 'sidechain')
    expect(readNumberField(sidechain, 'turnCount')).toBe(3)
    expect(readNumberField(sidechain, 'requestCount')).toBe(2)
    // 侧链 token 不计入总览的 usage
    expect(readNumberField(readObjectField(payload, 'overview'), 'turnCount')).toBe(7)
  })

  it('没有侧链活动时不出现 subagent 行与口径说明', async () => {
    // Arrange：默认夹具只有主链 turn
    await harness.seed()

    // Act
    const outcome = await harness.run(['stats'])

    // Assert
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).not.toContain('subagent 活动')
    expect(outcome.stdout).not.toContain('上方总览为主对话口径')
  })
})
