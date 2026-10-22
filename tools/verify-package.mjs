#!/usr/bin/env node
/** Exercise an installed release outside the workspace, using synthetic history. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSampleRoot } from './sample-data.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const directory = mkdtempSync(path.join(tmpdir(), 'turnflare-install-check-'))
const sample = createSampleRoot()
let child
async function stop() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit')
  }
  child = undefined
}
async function launch(command, env = {}) {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  child = spawn(
    process.execPath,
    [path.join(directory, 'node_modules/turnflare/packages/cli/dist/turnflare.mjs'), command],
    {
      cwd: directory,
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let errors = ''
  child.stderr.on('data', (chunk) => {
    errors += chunk
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Installed app did not start: ' + errors)),
      15000,
    )
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('http://')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Installed app exited ${code}: ${errors}`))
    })
  })
  return `http://127.0.0.1:${port}`
}
try {
  const install = spawnSync(
    'npm',
    [
      'install',
      '--prefix',
      directory,
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      path.join(root, `release/turnflare-${version}.tgz`),
    ],
    { stdio: 'inherit', timeout: 300000 },
  )
  assert.equal(install.status, 0, 'Production installation failed')
  const executable = path.join(directory, 'node_modules/turnflare/packages/cli/dist/turnflare.mjs')
  const info = spawnSync(process.execPath, [executable, '--version'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(info.status, 0, info.stderr)
  assert.match(info.stdout, /turnflare/)
  let url = await launch('demo')
  const health = await (await fetch(`${url}/api/health`)).json()
  assert.equal(health.data.sessionCount, 9)
  const html = await (await fetch(url)).text()
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1]
  assert.equal((await fetch(url + asset)).status, 200)
  assert.equal((await fetch(`${url}/mark.svg`)).status, 200)
  assert.equal(
    (
      await fetch(`${url}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  )
  await stop()
  url = await launch('start', {
    TURNFLARE_DATA_ROOT: sample,
    TURNFLARE_DB: path.join(directory, 'test.db'),
    TURNFLARE_WATCH_INTERVAL_MS: '1000',
    LOG_LEVEL: 'error',
  })
  const original = path.join(sample, '-demo-website', '00000000-0000-4000-8000-000000000001.jsonl')
  writeFileSync(
    path.join(sample, '-demo-website', 'new.jsonl'),
    readFileSync(original, 'utf8').replaceAll(
      '00000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
    ),
  )
  const deadline = Date.now() + 10000
  let count = 0
  while (Date.now() < deadline) {
    count = (await (await fetch(`${url}/api/health`)).json()).data.sessionCount
    if (count === 10) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(count, 10, 'Installed live scanner did not index a new session')
  console.log(
    'Installed release verified: CLI, dashboard, assets, read-only demo and live indexing.',
  )
} finally {
  await stop()
  rmSync(directory, { recursive: true, force: true })
  rmSync(sample, { recursive: true, force: true })
}
