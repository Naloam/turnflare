import path from 'node:path'
import { rmSync } from 'node:fs'
import { buildApp, createRepository, loadConfig, openDatabase, Scanner } from '@turnflare/api'
import type { DesktopState } from '@turnflare/contracts'
import { createSampleRoot } from '../../../tools/sample-data.mjs'
import { indexFileName } from './policy.js'

export type DesktopSource =
  { readonly mode: 'demo' } | { readonly mode: 'local'; readonly dataRoot: string }
export interface DesktopRuntime {
  readonly state: DesktopState
  request(input: { method: 'GET' | 'POST'; url: string; payload?: string }): Promise<{
    status: number
    headers: Readonly<Record<string, string>>
    body: Buffer
  }>
  close(): Promise<void>
}

/** Shares the HTTP implementation through injection; the desktop never opens a TCP port. */
export async function openDesktopRuntime(
  source: DesktopSource,
  options: {
    readonly indexDirectory: string
    readonly webRoot: string
    readonly version: string
    readonly watchIntervalMs?: number
  },
): Promise<DesktopRuntime> {
  const dataRoot = source.mode === 'demo' ? createSampleRoot() : path.resolve(source.dataRoot)
  const dbPath =
    source.mode === 'demo' ? ':memory:' : path.join(options.indexDirectory, indexFileName(dataRoot))
  const config = loadConfig({
    TURNFLARE_DATA_ROOT: dataRoot,
    TURNFLARE_DB: dbPath,
    TURNFLARE_VERSION: options.version,
    TURNFLARE_WATCH_INTERVAL_MS:
      source.mode === 'demo' ? '0' : String(options.watchIntervalMs ?? 10000),
    LOG_LEVEL: 'error',
  })
  const { db } = openDatabase(dbPath)
  const repo = createRepository(db)
  const api = buildApp({ repo, config, webRoot: options.webRoot })
  api.addHook('onClose', () => {
    if (db.open) db.close()
    if (source.mode === 'demo') rmSync(dataRoot, { recursive: true, force: true })
    return Promise.resolve()
  })
  if (source.mode === 'demo') {
    api.addHook('onRequest', async (request, reply) => {
      if (request.method === 'POST') {
        await reply.code(403).send({ success: false, data: null, error: 'Demo is read-only.' })
      }
    })
  }
  try {
    const outcome = await new Scanner({ repo, config }).scan({ rootDir: dataRoot })
    await api.ready()
    return {
      state: {
        mode: source.mode,
        dataRoot,
        sessionCount: repo.getOverview().sessionCount,
        failedFiles: outcome.failedFiles,
        version: options.version,
      },
      async request(input) {
        const payload = input.method === 'POST' ? input.payload || '{}' : undefined
        if (input.method === 'POST' && input.url.split('?')[0] === '/api/scan') {
          let body: unknown
          try {
            body = JSON.parse(payload ?? '{}')
          } catch {
            /* The API handles malformed JSON. */
          }
          if (
            typeof body === 'object' &&
            body !== null &&
            'rootDir' in body &&
            body.rootDir !== dataRoot
          ) {
            return {
              status: 403,
              headers: { 'content-type': 'application/json' },
              body: Buffer.from(
                JSON.stringify({
                  success: false,
                  data: null,
                  error: 'Use the native folder picker to change history locations.',
                }),
              ),
            }
          }
        }
        const reply = await api.inject({
          method: input.method,
          url: input.url,
          ...(payload === undefined
            ? {}
            : { payload, headers: { 'content-type': 'application/json' } }),
        })
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(reply.headers)) {
          if (value !== undefined) {
            headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
          }
        }
        return { status: reply.statusCode, headers, body: reply.rawPayload }
      },
      close: () => api.close(),
    }
  } catch (error) {
    await api.close()
    throw error
  }
}
