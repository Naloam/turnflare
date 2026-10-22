#!/usr/bin/env node
import { start } from './server.js'

void start().catch((error: unknown) => {
  process.stderr.write(
    `Turnflare failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
