#!/usr/bin/env node
/**
 * 解析性能基准。
 *
 * 为什么要它：`scan` 是用户感知最强的命令，而会话文件可能大到 16MB。
 * 没有基准的话，一次"顺手优化"就能把全量扫描从 3 秒变成 30 秒而没人发现。
 *
 * 用法：
 *   node tools/bench-parse.mjs [--root DIR] [--json]
 *
 * 退出码：0 全部达标 · 1 有项超阈值 · 2 环境错误
 *
 * 阈值是"预警线"不是"合格线"：本地机器比 CI 快，所以阈值放得比实测值宽。
 * 超了只说明该看一眼，不一定是回归——换机器、磁盘缓存冷热都会有影响。
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSampleRoot } from './sample-data.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const coreDist = path.join(root, 'packages/core/dist/index.js')

/** 阈值（毫秒）。实测值见下方 README 记录，阈值取实测的 3 倍左右 */
const THRESHOLDS = {
  /** 全量解析 ~/.claude/projects 的总耗时 */
  fullScanMs: 15_000,
  /** 单个 16MB 大文件的解析耗时 */
  bigFileMs: 5_000,
  /** 单次 aggregate（含成本计算）的耗时 */
  aggregateMs: 500,
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function envError(message) {
  console.error(`环境错误：${message}`)
  process.exit(2)
}

// ─── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let scanRoot = null
let asJson = false

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--root') {
    scanRoot = argv[i + 1]
    i += 1
    if (!scanRoot) envError('--root 需要一个目录参数')
  } else if (arg === '--json') {
    asJson = true
  } else if (arg === '--help' || arg === '-h') {
    console.log('用法：node tools/bench-parse.mjs [--root DIR] [--json]')
    process.exit(0)
  } else {
    envError(`未知参数 ${arg}`)
  }
}

// Stable workload for CI and first-time contributors. Real data is opt-in via --root.
if (scanRoot === null) {
  scanRoot = createSampleRoot()
  const temporaryRoot = scanRoot
  process.once('exit', () => fs.rmSync(temporaryRoot, { recursive: true, force: true }))
  const project = path.join(scanRoot, '-demo-benchmark')
  fs.mkdirSync(project)
  const row = JSON.stringify({
    type: 'assistant',
    sessionId: 'benchmark-session',
    timestamp: '2026-10-12T08:00:00Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'x'.repeat(16 * 1024) }],
      usage: { input_tokens: 1200, output_tokens: 180 },
    },
  })
  const rows = Array.from({ length: 1024 }, (_, index) =>
    JSON.stringify({ ...JSON.parse(row), uuid: `bench-${index}` }),
  )
  fs.writeFileSync(path.join(project, 'large-session.jsonl'), rows.join('\n') + '\n')
}

if (!fs.existsSync(coreDist)) {
  envError(`找不到 ${coreDist}\n请先执行：pnpm build`)
}
if (!fs.existsSync(scanRoot)) {
  envError(`扫描目录不存在：${scanRoot}`)
}

const core = await import(coreDist)

/** 计时助手：返回 [结果, 耗时毫秒] */
async function timed(fn) {
  const startedAt = process.hrtime.bigint()
  const value = await fn()
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
  return { value, elapsedMs }
}

// ─── 1. 找出最大的会话文件 ────────────────────────────────────────────────────
const discovered = await core.scanProjects(scanRoot)
const sized = []
for (const file of discovered) {
  sized.push({ filePath: file.filePath, sizeBytes: file.sizeBytes })
}
sized.sort((left, right) => right.sizeBytes - left.sizeBytes)
const biggest = sized[0]

// ─── 2. 单文件解析基准 ────────────────────────────────────────────────────────
const perFile = []
for (const candidate of sized.slice(0, 5)) {
  const { value: session, elapsedMs } = await timed(() => core.parseSessionFile(candidate.filePath))
  perFile.push({
    filePath: path.basename(candidate.filePath),
    sizeBytes: candidate.sizeBytes,
    elapsedMs,
    turns: session.turns.length,
    parseErrors: session.parseErrors.length,
  })
}

const bigFileMs = biggest ? (perFile[0]?.elapsedMs ?? 0) : 0

// ─── 3. 全量解析基准 ──────────────────────────────────────────────────────────
const { value: allSessions, elapsedMs: fullScanMs } = await timed(async () => {
  const sessions = []
  for (const file of discovered) {
    sessions.push(core.parseSessionFile(file.filePath))
  }
  return sessions
})

// ─── 4. aggregate 基准（含成本计算）──────────────────────────────────────────
const { elapsedMs: aggregateMs } = await timed(() =>
  core.aggregate(allSessions, {
    costCalculator: (usage, model) => core.costOf({ usage, model }),
  }),
)

const totalTurns = allSessions.reduce((sum, session) => sum + session.turns.length, 0)
const totalParseErrors = allSessions.reduce((sum, session) => sum + session.parseErrors.length, 0)
const totalBytes = sized.reduce((sum, entry) => sum + entry.sizeBytes, 0)

// ─── 汇总 ────────────────────────────────────────────────────────────────────
const checks = [
  {
    name: `全量解析 ${String(discovered.length)} 个文件`,
    actualMs: fullScanMs,
    thresholdMs: THRESHOLDS.fullScanMs,
  },
  {
    name: `最大单文件（${biggest ? Math.round(biggest.sizeBytes / 1024 / 1024) : 0} MB）`,
    actualMs: bigFileMs,
    thresholdMs: THRESHOLDS.bigFileMs,
  },
  { name: 'aggregate（含成本计算）', actualMs: aggregateMs, thresholdMs: THRESHOLDS.aggregateMs },
]

if (asJson) {
  console.log(
    JSON.stringify(
      {
        root: scanRoot,
        files: discovered.length,
        totalBytes,
        totalTurns,
        totalParseErrors,
        fullScanMs,
        bigFileMs,
        aggregateMs,
        perFile,
        checks: checks.map((check) => ({
          ...check,
          passed: check.actualMs <= check.thresholdMs,
        })),
      },
      null,
      2,
    ),
  )
} else {
  console.log('=== Turnflare 解析性能基准 ===\n')
  console.log(`数据根目录  ${scanRoot}`)
  console.log(
    `文件        ${discovered.length} 个，合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
  )
  console.log(`turn        ${totalTurns.toLocaleString('en-US')} 条`)
  console.log(`解析错误    ${totalParseErrors} 条\n`)

  console.log('最大的 5 个文件：')
  for (const entry of perFile) {
    const mb = (entry.sizeBytes / 1024 / 1024).toFixed(2)
    console.log(
      `  ${mb.padStart(8)} MB  ${entry.elapsedMs.toFixed(0).padStart(6)} ms  ` +
        `${String(entry.turns).padStart(6)} turn  ${entry.filePath.slice(0, 40)}`,
    )
  }

  console.log('\n阈值检查：')
  for (const check of checks) {
    const ratio = check.actualMs / check.thresholdMs
    const mark = check.actualMs <= check.thresholdMs ? '✓' : '✗'
    console.log(
      `  ${mark} ${check.name.padEnd(38)} ` +
        `${check.actualMs.toFixed(0).padStart(7)} ms / 上限 ${String(check.thresholdMs).padStart(6)} ms` +
        `  (${(ratio * 100).toFixed(0)}%)`,
    )
  }

  console.log(`\n吞吐        ${(totalBytes / 1024 / 1024 / (fullScanMs / 1000)).toFixed(1)} MB/s`)
}

const failed = checks.filter((check) => check.actualMs > check.thresholdMs)
if (failed.length > 0) {
  fail(`${failed.length} 项超出阈值（可能是回归，也可能是机器差异）`)
}
if (!asJson) console.log('\n✓ 全部达标')
