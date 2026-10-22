import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

test('the documented repository CLI forwards flags without a literal separator', () => {
  const result = spawnSync('pnpm', ['cli', '--version'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    timeout: 20000,
  })
  assert.equal(result.status, 0, result.stderr)
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(result.stdout.includes(`turnflare ${version}`))
  assert.doesNotMatch(result.stderr, /未知选项/)
})
