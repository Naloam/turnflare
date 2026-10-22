import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createSampleRoot } from '../../../tools/sample-data.mjs'
import { openDesktopRuntime, type DesktopRuntime } from './runtime.js'

let runtime: DesktopRuntime | undefined
const roots: string[] = []
function directory() {
  const root = mkdtempSync(path.join(tmpdir(), 'turnflare-desktop-test-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await runtime?.close()
  runtime = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('serves the real dashboard and API in-process, without a listening socket', async () => {
  runtime = await openDesktopRuntime(
    { mode: 'demo' },
    {
      indexDirectory: directory(),
      webRoot: path.resolve('../web/dist'),
      version: '0.2.0',
    },
  )
  expect(runtime.state.sessionCount).toBe(9)
  const health = await runtime.request({ method: 'GET', url: '/api/health' })
  expect(JSON.parse(health.body.toString()).data.version).toBe('0.2.0')
  const page = await runtime.request({ method: 'GET', url: '/' })
  expect(page.body.toString()).toContain('Turnflare')
  const write = await runtime.request({ method: 'POST', url: '/api/scan', payload: '{}' })
  expect(write.status).toBe(403)
  const root = runtime.state.dataRoot
  await runtime.close()
  runtime = undefined
  expect(existsSync(root)).toBe(false)
})

it('keeps each selected folder in its own index and live-indexes new sessions', async () => {
  const sample = createSampleRoot()
  roots.push(sample)
  const indexes = directory()
  runtime = await openDesktopRuntime(
    { mode: 'local', dataRoot: sample },
    {
      indexDirectory: indexes,
      webRoot: directory(),
      version: '0.2.0',
      watchIntervalMs: 1000,
    },
  )
  expect(runtime.state.sessionCount).toBe(9)
  const original = path.join(sample, '-demo-website', '00000000-0000-4000-8000-000000000001.jsonl')
  const refused = await runtime.request({
    method: 'POST',
    url: '/api/scan',
    payload: JSON.stringify({ rootDir: directory() }),
  })
  expect(refused.status).toBe(403)
  const scan = await runtime.request({ method: 'POST', url: '/api/scan' })
  expect(scan.status).toBe(200)
  expect(JSON.parse(scan.body.toString()).success).toBe(true)
  writeFileSync(
    path.join(sample, '-demo-website', 'extra.jsonl'),
    readFileSync(original, 'utf8').replaceAll(
      '00000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
    ),
  )
  await expect
    .poll(
      async () => {
        const response = await runtime!.request({ method: 'GET', url: '/api/health' })
        return JSON.parse(response.body.toString()).data.sessionCount
      },
      { timeout: 5000 },
    )
    .toBe(10)
  await runtime.close()
  runtime = await openDesktopRuntime(
    { mode: 'local', dataRoot: directory() },
    {
      indexDirectory: indexes,
      webRoot: directory(),
      version: '0.2.0',
    },
  )
  expect(runtime.state.sessionCount).toBe(0)
})
