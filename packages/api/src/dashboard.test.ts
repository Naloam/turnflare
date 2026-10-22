import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './server.js'
import { loadConfig } from './config.js'
import { FakeRepository } from './test-support/fake-repository.js'

describe('single-origin dashboard', () => {
  let app: FastifyInstance | undefined
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'turnflare-dashboard-'))
    mkdirSync(path.join(root, 'assets'))
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Turnflare</title>')
    writeFileSync(path.join(root, 'assets', 'app.js'), 'window.turnflare = true')
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    rmSync(root, { recursive: true, force: true })
  })

  it('serves the dashboard, assets and API through the same app', async () => {
    app = buildApp({
      repo: new FakeRepository(),
      config: loadConfig({ LOG_LEVEL: 'error' }),
      webRoot: root,
    })
    const page = await app.inject('/')
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.body).toContain('<title>Turnflare</title>')
    expect((await app.inject('/assets/app.js')).body).toContain('window.turnflare')
    expect((await app.inject('/api/health')).statusCode).toBe(200)
  })

  it('keeps missing assets and API paths as 404 instead of returning HTML', async () => {
    app = buildApp({
      repo: new FakeRepository(),
      config: loadConfig({ LOG_LEVEL: 'error' }),
      webRoot: root,
    })
    for (const url of ['/assets/missing.js', '/api/missing', '/.env', '/package.json']) {
      const response = await app.inject(url)
      expect(response.statusCode).toBe(404)
      expect(response.headers['content-type']).toContain('application/json')
    }
  })

  it('runs the API when no built dashboard is available', async () => {
    app = buildApp({
      repo: new FakeRepository(),
      config: loadConfig({ LOG_LEVEL: 'error' }),
      webRoot: path.join(root, 'missing'),
    })
    expect((await app.inject('/')).statusCode).toBe(404)
    expect((await app.inject('/api/health')).statusCode).toBe(200)
  })
})
