#!/usr/bin/env node
/**
 * 把 SQL 迁移文件复制进 dist。
 *
 * tsc 只编译 .ts，不会处理 .sql，而 db/index.ts 在运行时按
 * `dist/db/migrations` 读取迁移脚本。少了这一步，`pnpm build` 之后的
 * `pnpm start` 会在第一次 openDatabase 时崩在 readdirSync 上。
 * 用 node 而不是 `cp -r`：重复构建时行为可预期，且跨平台一致。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')
const sourceDir = path.join(packageRoot, 'src/db/migrations')
const targetDir = path.join(packageRoot, 'dist/db/migrations')

if (!fs.existsSync(sourceDir)) {
  console.error(`找不到迁移目录：${sourceDir}`)
  process.exit(1)
}

const sqlFiles = fs
  .readdirSync(sourceDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (sqlFiles.length === 0) {
  console.error(`迁移目录里没有 .sql 文件：${sourceDir}`)
  process.exit(1)
}

fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })

for (const name of sqlFiles) {
  fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name))
}

console.log(`已复制 ${sqlFiles.length} 个迁移文件到 ${path.relative(packageRoot, targetDir)}`)
