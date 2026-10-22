/**
 * 测试替身：默认依赖装配。
 *
 * 真 `openDatabase` / `createRepository` / `loadConfig` / `collectReportData` /
 * `renderReport` 全部保留——测试要验证的就是"CLI 与 api/core 的真实接线"。
 * 只替换三样会污染外部世界的东西：进度条（会往 stderr 画字符）、
 * 写文件（不能碰磁盘）、serve 的监听与退出信号（不能真占端口）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDefaultDeps } from '../deps.js'
import type { CliDeps } from '../deps.js'
import { createSilentProgress } from '../progress.js'

export interface FileWrite {
  readonly path: string
  readonly content: string
}

export interface ServeProbe {
  /** listen 被调用的参数 */
  readonly listenCalls: readonly { readonly port: number; readonly host: string }[]
  /** close 被调用的次数 */
  closeCount(): number
  /** 模拟收到 SIGINT */
  triggerShutdown(): void
}

export interface TestDeps {
  readonly deps: CliDeps
  readonly writes: readonly FileWrite[]
  readonly serve: ServeProbe
}

/** 装配一套可断言的依赖 */
export function createTestDeps(): TestDeps {
  const writes: FileWrite[] = []
  const listenCalls: { port: number; host: string }[] = []
  let closes = 0
  let resolveShutdown: (() => void) | null = null
  // 信号可能比 awaitShutdown() 更早触发（测试里就是如此），
  // 所以除了保存 resolve，还要记住"已经请求过退出"。
  let shutdownRequested = false

  const deps: CliDeps = {
    ...createDefaultDeps(),
    createProgress: () => createSilentProgress(),
    writeFile: (filePath, content) => {
      writes.push({ path: filePath, content })
    },
    listen: (_app, config) => {
      listenCalls.push({ port: config.port, host: config.host })
      return Promise.resolve({
        url: `http://${config.host}:${String(config.port)}`,
        close: () => {
          closes += 1
          return Promise.resolve()
        },
      })
    },
    awaitShutdown: () =>
      new Promise<void>((resolve) => {
        if (shutdownRequested) {
          resolve()
          return
        }
        resolveShutdown = resolve
      }),
  }

  return {
    deps,
    writes,
    serve: {
      listenCalls,
      closeCount: () => closes,
      triggerShutdown: () => {
        shutdownRequested = true
        resolveShutdown?.()
      },
    },
  }
}

// ─── 会话夹具 ───────────────────────────────────────────────────────────────

/** 行级选项：侧链（subagent）记录与主链记录同构，只多一个 isSidechain 标记 */
interface LineOptions {
  readonly isSidechain: boolean
}

const MAIN_CHAIN: LineOptions = { isSidechain: false }
const SIDE_CHAIN: LineOptions = { isSidechain: true }

/** 一条最小可识别的 user 记录 */
function userLine(
  sessionId: string,
  uuid: string,
  text: string,
  timestamp: string,
  options: LineOptions = MAIN_CHAIN,
): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    parentUuid: null,
    timestamp,
    isSidechain: options.isSidechain,
    sessionId,
    cwd: '/Users/che1sy/Projects/alpha',
    gitBranch: 'main',
    version: '2.0.30',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

/** 一条带 token 用量与工具调用的 assistant 记录 */
function assistantLine(
  sessionId: string,
  uuid: string,
  parentUuid: string,
  timestamp: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  options: LineOptions = MAIN_CHAIN,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp,
    isSidechain: options.isSidechain,
    message: {
      role: 'assistant',
      model,
      usage: {
        input_tokens: inputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
      content: [
        { type: 'tool_use', id: `toolu_${uuid}`, name: 'Read', input: { file_path: '/tmp/a.ts' } },
        { type: 'text', text: '已完成' },
      ],
    },
  })
}

/** 一条配对的 tool_result（user 消息） */
function toolResultLine(
  sessionId: string,
  uuid: string,
  parentUuid: string,
  timestamp: string,
): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    parentUuid,
    timestamp,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: `toolu_${parentUuid}`,
          content: '文件内容',
          is_error: false,
        },
      ],
    },
  })
}

const ALPHA_PROJECT = '-Users-che1sy-Projects-alpha'
const BETA_PROJECT = '-Users-che1sy-Projects-beta'
const BULK_PROJECT = '-Users-che1sy-Projects-bulk'

/** 已定价模型：用来产生可断言的成本数字 */
export const PRICED_MODEL = 'claude-opus-5-5'

/** 价目表里没有的模型：用来触发 unpricedModel 警告 */
export const UNPRICED_MODEL = 'step-5-preview'

/**
 * 侧链（subagent）turn 块。
 *
 * 真实数据里 subagent 记录与主链记录躺在同一个 sessionId 下，只靠 isSidechain 区分；
 * 这里照抄那个形状。时间戳插在 alpha 主链两轮之间，避免把会话的"最近活动"
 * 推到 beta 之后——那会改变 sessions 列表按 recent 排序的结果。
 */
function sidechainLines(sessionId: string): readonly string[] {
  return [
    userLine(sessionId, 'a-su1', 'subagent：检查这个文件', '2026-10-18T08:00:30.000Z', SIDE_CHAIN),
    assistantLine(
      sessionId,
      'a-sa1',
      'a-su1',
      '2026-10-18T08:00:35.000Z',
      PRICED_MODEL,
      1000,
      500,
      SIDE_CHAIN,
    ),
    assistantLine(
      sessionId,
      'a-sa2',
      'a-sa1',
      '2026-10-18T08:00:40.000Z',
      PRICED_MODEL,
      2000,
      700,
      SIDE_CHAIN,
    ),
  ]
}

/** 夹具变体；默认值保持"只有主链"的既有口径，老测试不受影响 */
export interface SessionFixtureOptions {
  /** 是否在 alpha 会话里掺入侧链 turn */
  readonly includeSidechain: boolean
}

const DEFAULT_FIXTURE_OPTIONS: SessionFixtureOptions = { includeSidechain: false }

/**
 * 造一个真实的会话目录树：
 *   <root>/-Users-che1sy-Projects-alpha/a.jsonl    两轮对话 + 工具调用
 *   <root>/-Users-che1sy-Projects-beta/b.jsonl     一轮对话，模型无价目
 *   <root>/-Users-che1sy-Projects-alpha/skill-injections.jsonl  插件遥测（非会话）
 *   <root>/-Users-che1sy-Projects-beta/empty.jsonl 空文件
 *
 * uuid 必须全场唯一：`turns.uuid` 是主键，跨会话复用会让插入被静默跳过。
 */
export function writeSessionFixture(
  rootDir: string,
  options: SessionFixtureOptions = DEFAULT_FIXTURE_OPTIONS,
): void {
  const alpha = [
    userLine('sess-alpha-1', 'a-u1', '帮我看看这个项目', '2026-10-18T08:00:00.000Z'),
    assistantLine(
      'sess-alpha-1',
      'a-a1',
      'a-u1',
      '2026-10-18T08:00:05.000Z',
      PRICED_MODEL,
      40198,
      1183,
    ),
    toolResultLine('sess-alpha-1', 'a-u2', 'a-a1', '2026-10-18T08:00:06.000Z'),
    userLine('sess-alpha-1', 'a-u3', '谢谢', '2026-10-18T08:01:00.000Z'),
    assistantLine(
      'sess-alpha-1',
      'a-a2',
      'a-u3',
      '2026-10-18T08:01:05.000Z',
      PRICED_MODEL,
      1200,
      300,
    ),
  ]
  if (options.includeSidechain) {
    alpha.push(...sidechainLines('sess-alpha-1'))
  }
  const beta = [
    userLine('sess-beta-1', 'b-u1', '另一个项目的会话', '2026-10-19T09:00:00.000Z'),
    assistantLine(
      'sess-beta-1',
      'b-a1',
      'b-u1',
      '2026-10-19T09:00:05.000Z',
      UNPRICED_MODEL,
      500,
      100,
    ),
  ]

  writeFixtureFile(join(rootDir, ALPHA_PROJECT, 'a.jsonl'), alpha)
  writeFixtureFile(join(rootDir, BETA_PROJECT, 'b.jsonl'), beta)
  writeFixtureFile(join(rootDir, ALPHA_PROJECT, 'skill-injections.jsonl'), [
    JSON.stringify({
      timestamp: '2026-10-19T09:00:00.000Z',
      event: 'skill-injection',
      toolName: 'Write',
    }),
  ])
  writeFixtureFile(join(rootDir, BETA_PROJECT, 'empty.jsonl'), [])
}

/** 写一个夹具文件；父目录不存在时先建 */
function writeFixtureFile(filePath: string, lines: readonly string[]): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
}

/** 建一个临时会话根目录并写好夹具；调用方负责 `removeFixtureRoot` */
export function createFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'turnflare-cli-'))
  writeSessionFixture(root)
  return root
}

/**
 * 建一个带侧链活动的临时根目录；调用方负责 `removeFixtureRoot`。
 *
 * 单独一个入口而不是给默认夹具加侧链：绝大多数命令的测试要验的是主链口径，
 * 默认夹具一旦掺了侧链，那些用例的期望值全得跟着改。
 */
export function createSidechainFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'turnflare-cli-sidechain-'))
  writeSessionFixture(root, { includeSidechain: true })
  return root
}

/**
 * 造一个只含 N 场最小会话的根目录；调用方负责 `removeFixtureRoot`。
 *
 * 单独一个入口而不是给默认夹具加参数：默认夹具刻意保持两场，绝大多数列表
 * 测试要验的就是"两场时的排序与汇总"。只有需要把会话数推过
 * `MAX_SESSION_LIMIT` 时（例如验"limit 触顶时摘要行怎么说"）才用它。
 */
export function createBulkSessionRoot(sessionCount: number): string {
  const root = mkdtempSync(join(tmpdir(), 'turnflare-cli-bulk-'))
  for (let index = 0; index < sessionCount; index += 1) {
    const sessionId = `sess-bulk-${String(index)}`
    const userUuid = `bulk-u${String(index)}`
    writeFixtureFile(join(root, BULK_PROJECT, `${String(index).padStart(4, '0')}.jsonl`), [
      userLine(sessionId, userUuid, '批量会话', '2026-10-19T09:00:00.000Z'),
      assistantLine(
        sessionId,
        `bulk-a${String(index)}`,
        userUuid,
        '2026-10-19T09:00:05.000Z',
        PRICED_MODEL,
        10,
        5,
      ),
    ])
  }
  return root
}

/** 清理临时目录 */
export function removeFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
