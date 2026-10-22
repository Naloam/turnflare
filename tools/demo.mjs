#!/usr/bin/env node
/**
 * Turnflare 全管线演示与冒烟验证。
 *
 * 默认用固定示例数据跑完整条管线（--root 可显式指定真实数据）：
 *   发现文件 → 解析 → 增量判定 → 落库 → 聚合查询 → 导出报告
 * 用来验证 api 数据层在真实数据上的行为，也是给使用者的一键演示。
 *
 * 用法：
 *   node tools/demo.mjs [--root DIR] [--db PATH] [--keep]
 *
 *   --root DIR  要扫描的目录，默认安全的临时示例数据
 *   --db PATH   数据库路径，默认临时文件（用后即删）
 *   --keep      保留临时数据库，便于事后用 sqlite3 检查
 *
 * 退出码：0 全部断言通过 · 1 有断言失败 · 2 用法或环境错误
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSampleRoot } from './sample-data.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const API_DIST = path.join(root, 'packages/api/dist/index.js')
const CORE_DIST = path.join(root, 'packages/core/dist/index.js')

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function usageError(message) {
  console.error(`用法错误：${message}`)
  console.error('用法：node tools/demo.mjs [--root DIR] [--db PATH] [--keep]')
  process.exit(2)
}

// ─── 参数解析 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let scanRoot = null
let dbPath = null
let keepDb = false

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--root') {
    scanRoot = argv[i + 1]
    i += 1
    if (!scanRoot) usageError('--root 需要一个目录参数')
  } else if (arg === '--db') {
    dbPath = argv[i + 1]
    i += 1
    if (!dbPath) usageError('--db 需要一个路径参数')
  } else if (arg === '--keep') {
    keepDb = true
  } else if (arg === '--help' || arg === '-h') {
    console.log('用法：node tools/demo.mjs [--root DIR] [--db PATH] [--keep]')
    process.exit(0)
  } else {
    usageError(`未知参数 ${arg}`)
  }
}

const sampleRoot = scanRoot === null ? createSampleRoot() : null
scanRoot ??= sampleRoot
if (sampleRoot) process.once('exit', () => fs.rmSync(sampleRoot, { recursive: true, force: true }))

if (!fs.existsSync(API_DIST)) {
  fail(`找不到 ${API_DIST}\n请先执行：pnpm build`)
}
if (!fs.existsSync(CORE_DIST)) {
  fail(`找不到 ${CORE_DIST}\n请先执行：pnpm build`)
}
if (!fs.existsSync(scanRoot)) {
  fail(`扫描目录不存在：${scanRoot}`)
}

// ─── 装配 ────────────────────────────────────────────────────────────────────
const api = await import(API_DIST)
const core = await import(CORE_DIST)
const { openDatabase, createRepository, Scanner, loadConfig } = api
const { formatTokens, formatCost, formatPercent } = core

if (typeof openDatabase !== 'function') fail('api 未导出 openDatabase')
if (typeof createRepository !== 'function') fail('api 未导出 createRepository')
if (typeof Scanner !== 'function') fail('api 未导出 Scanner')
if (typeof loadConfig !== 'function') fail('api 未导出 loadConfig')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnflare-demo-'))
const finalDbPath = dbPath ?? path.join(tempDir, 'demo.db')
const cleanup = () => {
  if (!keepDb && !dbPath) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
process.on('exit', cleanup)

const config = loadConfig({ TURNFLARE_DB: finalDbPath, TURNFLARE_DATA_ROOT: scanRoot })
const { db } = openDatabase(config.dbPath)
const repo = createRepository(db)

const scanner = new Scanner({
  repo,
  config,
  onProgress: (done, total, filePath) => {
    if (done % 10 === 0 || done === total) {
      process.stdout.write(`\r  扫描进度 ${done}/${total}  ${path.basename(filePath).slice(0, 40)}`)
    }
  },
})

console.log('=== Turnflare 全管线演示 ===')
console.log(`数据根目录：${scanRoot}`)
console.log(`数据库    ：${finalDbPath}`)
console.log('')

// ─── 第一轮扫描 ──────────────────────────────────────────────────────────────
console.log('[1/5] 首次扫描（全量）')
const first = await scanner.scan({ rootDir: scanRoot })
console.log(
  `\n  总文件 ${first.totalFiles}，新扫 ${first.scannedFiles}，` +
    `未变化跳过 ${first.skippedFiles}，非会话跳过 ${first.skippedEmpty ?? 0}，失败 ${first.failedFiles}`,
)
if (first.failures?.length) {
  console.log('  失败样例：')
  for (const f of first.failures.slice(0, 3)) {
    console.log(`    - ${f.filePath}: ${f.reason}`)
  }
}

// ─── 第二轮扫描（验证增量）────────────────────────────────────────────────────
console.log('\n[2/5] 二次扫描（验证增量跳过）')
const second = await scanner.scan({ rootDir: scanRoot })
console.log(
  `  新扫 ${second.scannedFiles}，未变化跳过 ${second.skippedFiles}，非会话跳过 ${second.skippedEmpty ?? 0}`,
)
if (second.skippedFiles === 0) {
  fail('增量判定失效：第二轮没有跳过任何文件')
}
// 注意：仍在写入的活跃会话（包括当前这个）会持续重扫，这是正确行为——
// 它们的内容确实变了。所以这里只要求"有跳过"，不要求"零重扫"。
if (second.scannedFiles > 0) {
  console.log(`  说明：${second.scannedFiles} 个文件仍在写入中（活跃会话），重扫属于预期行为`)
}

// ─── 聚合查询 ────────────────────────────────────────────────────────────────
console.log('\n[3/5] 聚合查询')
const overview = repo.getOverview()
const sessionCount = repo.countSessions()

console.log(`  会话数      ：${sessionCount}`)
console.log(`  turn 数     ：${overview.turnCount}`)
console.log(`  输入 token  ：${formatTokens(overview.usage.inputTokens)}`)
console.log(`  缓存写      ：${formatTokens(overview.usage.cacheCreationTokens)}`)
console.log(`  缓存读      ：${formatTokens(overview.usage.cacheReadTokens)}`)
console.log(`  输出 token  ：${formatTokens(overview.usage.outputTokens)}`)
console.log(`  思考 token  ：${formatTokens(overview.usage.thinkingTokens)}`)
console.log(`  缓存命中率  ：${formatPercent(overview.cacheHitRate)}`)
console.log(`  总成本      ：${formatCost(overview.cost.totalCost)}`)
if (overview.cost.unpricedModel) {
  console.log('  ⚠ 存在无价目数据的模型，上述成本未覆盖全部用量')
}
console.log(`  首次活动    ：${overview.firstActivityAt ?? '无'}`)
console.log(`  最近活动    ：${overview.lastActivityAt ?? '无'}`)

console.log('\n  模型分布（Top 5）：')
for (const m of overview.byModel.slice(0, 5)) {
  console.log(
    `    ${m.model.padEnd(28)} ${String(m.requestCount).padStart(6)} 次  ` +
      `${formatTokens(m.usage.outputTokens).padStart(9)} out  ${formatCost(m.cost.totalCost).padStart(12)}`,
  )
}

console.log('\n  项目分布（Top 5）：')
for (const p of overview.byProject.slice(0, 5)) {
  console.log(
    `    ${p.projectSlug.slice(0, 40).padEnd(42)} ${String(p.sessionCount).padStart(4)} 会话  ` +
      `${formatCost(p.cost.totalCost).padStart(12)}`,
  )
}

console.log('\n  工具调用（Top 8）：')
for (const t of overview.toolUsage.slice(0, 8)) {
  const errRate = t.callCount > 0 ? (t.errorCount / t.callCount) * 100 : 0
  console.log(
    `    ${t.toolName.padEnd(16)} ${String(t.callCount).padStart(5)} 次  ` +
      `错误 ${String(t.errorCount).padStart(3)} (${errRate.toFixed(1)}%)  ` +
      `结果 ${(t.totalResultBytes / 1024).toFixed(0)} KB`,
  )
}

// ─── 会话列表与详情 ──────────────────────────────────────────────────────────
console.log('\n[4/5] 会话列表与详情')
const list = repo.listSessions({ page: 1, limit: 5, sort: 'cost', order: 'desc' })
console.log(`  共 ${list.total} 个会话，取前 ${list.items.length} 个（按成本降序）`)
for (const s of list.items) {
  console.log(
    `    ${s.sessionId.slice(0, 8)}  ${s.projectSlug.slice(0, 30).padEnd(32)} ` +
      `${String(s.turnCount).padStart(5)} turns  ${formatCost(s.cost.totalCost).padStart(12)}`,
  )
}

if (list.items.length > 0) {
  const detail = repo.getSession(list.items[0].sessionId)
  if (!detail) {
    fail(`会话详情查询失败：${list.items[0].sessionId}`)
  }
  console.log(`\n  详情抽样（${detail.sessionId.slice(0, 8)}）：`)
  console.log(`    turns ${detail.turns.length} 条，解析错误 ${detail.parseErrorCount} 条`)
  const assistantTurns = detail.turns.filter((t) => t.role === 'assistant')
  console.log(
    `    其中 assistant ${assistantTurns.length} 条，` +
      `带 usage 的 ${assistantTurns.filter((t) => t.usage !== null).length} 条`,
  )
}

const timeline = repo.getTimeline({ granularity: 'day' })
console.log(`\n  时间线（天）：${timeline.length} 个桶`)
for (const b of timeline.slice(-5)) {
  console.log(
    `    ${b.bucket}  ${formatTokens(b.usage.outputTokens).padStart(9)} out  ${formatCost(b.cost.totalCost).padStart(12)}`,
  )
}

// ─── 断言 ────────────────────────────────────────────────────────────────────
console.log('\n[5/5] 断言')

const assertions = [
  {
    name: '扫描发现了文件',
    ok: first.totalFiles > 0,
    detail: `totalFiles=${first.totalFiles}`,
  },
  {
    name: '至少落库一个会话',
    ok: sessionCount > 0,
    detail: `sessionCount=${sessionCount}`,
  },
  {
    name: '聚合出 token 用量',
    ok: overview.usage.outputTokens > 0,
    detail: `outputTokens=${overview.usage.outputTokens}`,
  },
  {
    name: '缓存命中率在 [0,1]',
    ok: overview.cacheHitRate >= 0 && overview.cacheHitRate <= 1,
    detail: `cacheHitRate=${overview.cacheHitRate}`,
  },
  {
    name: '模型分布非空且按成本降序',
    ok:
      overview.byModel.length > 0 &&
      overview.byModel.every(
        (m, i, arr) => i === 0 || arr[i - 1].cost.totalCost >= m.cost.totalCost,
      ),
    detail: `models=${overview.byModel.length}`,
  },
  {
    name: '项目分布非空',
    ok: overview.byProject.length > 0,
    detail: `projects=${overview.byProject.length}`,
  },
  {
    name: '工具统计非空',
    ok: overview.toolUsage.length > 0,
    detail: `tools=${overview.toolUsage.length}`,
  },
  {
    name: '时间线字典序即时间序',
    ok: timeline.every((b, i, arr) => i === 0 || arr[i - 1].bucket <= b.bucket),
    detail: `buckets=${timeline.length}`,
  },
  {
    name: '会话列表分页 meta 自洽',
    ok: list.total >= list.items.length && list.items.length <= 5,
    detail: `total=${list.total}, items=${list.items.length}`,
  },
  {
    name: '无价目模型被明确标记',
    ok: typeof overview.cost.unpricedModel === 'boolean',
    detail: `unpricedModel=${overview.cost.unpricedModel}`,
  },
  {
    name: '增量扫描第二轮有跳过',
    ok: second.skippedFiles > 0,
    detail: `skippedFiles=${second.skippedFiles}`,
  },
]

let failedCount = 0
for (const a of assertions) {
  const mark = a.ok ? '✓' : '✗'
  console.log(`  ${mark} ${a.name}（${a.detail}）`)
  if (!a.ok) failedCount += 1
}

db.close()

if (failedCount > 0) {
  console.log(`\n✗ ${failedCount}/${assertions.length} 条断言失败`)
  process.exit(1)
}

console.log(`\n✓ 全部 ${assertions.length} 条断言通过`)
if (keepDb) {
  console.log(`数据库保留在：${finalDbPath}`)
}
if (keepDb || dbPath) {
  console.log(`检查数据库：sqlite3 ${finalDbPath}`)
}
process.exit(0)
