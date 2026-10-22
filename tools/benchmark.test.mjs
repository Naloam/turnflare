import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('the default benchmark uses a reproducible workload without personal history', () => {
  const result = spawnSync(process.execPath, ['tools/bench-parse.mjs', '--json'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.match(report.root, /turnflare-sample-/)
  assert.ok(report.totalBytes >= 16 * 1024 * 1024)
  assert.ok(report.files >= 10)
  assert.equal(report.totalParseErrors, 0)
})
