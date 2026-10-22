import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('release contains the dashboard, migrations and executable without workspace dependencies', () => {
  const result = spawnSync(process.execPath, ['tools/package.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  const artifact = JSON.parse(result.stdout)
  const manifest = JSON.parse(readFileSync(`${artifact.directory}/package.json`, 'utf8'))
  assert.equal(manifest.name, 'turnflare')
  assert.ok(
    Object.values(manifest.dependencies).every((version) => !version.startsWith('workspace:')),
  )
  for (const expected of [
    'packages/web/dist/index.html',
    'packages/cli/dist/migrations/001_initial.sql',
    'packages/cli/dist/turnflare.mjs',
    'LICENSE',
  ]) {
    assert.ok(artifact.files.includes(expected), expected)
  }
})
