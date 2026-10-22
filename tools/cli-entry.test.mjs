import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('the documented repository CLI forwards flags without a literal separator', () => {
  const result = spawnSync('pnpm', ['cli', '--version'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /0\.1\.0/)
  assert.doesNotMatch(result.stderr, /未知选项/)
})
