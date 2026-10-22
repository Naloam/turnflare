import {
  loadConfig,
  openDatabase,
  createRepository,
  Scanner,
  start,
} from '../packages/api/dist/index.js'

const config = loadConfig({
  ...process.env,
  TURNFLARE_WATCH_INTERVAL_MS: process.env.TURNFLARE_WATCH_INTERVAL_MS ?? '10000',
})
const { db } = openDatabase(config.dbPath)
try {
  const repo = createRepository(db)
  const result = await new Scanner({ repo, config }).scan({ rootDir: config.dataRoot })
  console.log(
    `Indexed ${result.scannedFiles} files; ${result.failedFiles} failed. Live updates every ${config.watchIntervalMs / 1000}s.`,
  )
} finally {
  db.close()
}
await start(config)
console.log(`Turnflare: http://${config.host}:${config.port}`)
