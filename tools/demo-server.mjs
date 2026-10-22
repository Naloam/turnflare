#!/usr/bin/env node
/** Disposable dashboard: all data is synthetic and all storage is in memory. */
import { rmSync } from 'node:fs'
import { createSampleRoot } from './sample-data.mjs'
import {
  Scanner,
  buildApp,
  createRepository,
  loadConfig,
  openDatabase,
} from '../packages/api/dist/index.js'

const root = createSampleRoot()
// Do not inherit HOST, TURNFLARE_DB or TURNFLARE_DATA_ROOT from a real installation.
const config = loadConfig({
  PORT: process.env.PORT,
  TURNFLARE_DB: ':memory:',
  TURNFLARE_DATA_ROOT: root,
  LOG_LEVEL: 'error',
})
const { db } = openDatabase(':memory:')
let app
const close = async () => {
  await app?.close()
  if (db.open) db.close()
  rmSync(root, { recursive: true, force: true })
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
}
const onSignal = () => {
  void close().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
try {
  const repo = createRepository(db)
  await new Scanner({ repo, config }).scan({ rootDir: root })
  app = buildApp({ repo, config })
  // Demo cannot scan arbitrary paths through the write endpoint.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST') {
      await reply.code(403).send({ success: false, data: null, error: 'Demo is read-only.' })
    }
  })
  const url = await app.listen({ host: config.host, port: config.port })
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  console.log(
    `Turnflare demo: ${url}\n9 example sessions · 3 projects · synthetic data only\nPress Ctrl+C to stop.`,
  )
} catch (error) {
  await close()
  console.error(`Unable to start demo: ${error.message}`)
  process.exitCode = 1
}
