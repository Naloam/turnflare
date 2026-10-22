import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createSampleRoot } from './sample-data.mjs'
import { Scanner, openDatabase, createRepository, loadConfig } from '../packages/api/dist/index.js'

test('sample data exercises real scanning, cost, projects, subagents and incremental skips', async () => {
  const root = createSampleRoot()
  const { db } = openDatabase(':memory:')
  try {
    const repo = createRepository(db)
    const scanner = new Scanner({ repo, config: loadConfig({ TURNFLARE_DATA_ROOT: root }) })
    const first = await scanner.scan({ rootDir: root })
    assert.equal(first.scannedFiles, 9)
    assert.equal(first.skippedEmpty, 1)
    assert.equal(first.failedFiles, 0)
    const overview = repo.getOverview()
    assert.equal(overview.sessionCount, 9)
    assert.equal(overview.byProject.length, 3)
    assert.equal(overview.sidechain.turnCount, 9)
    assert.ok(overview.cost.totalCost > 0)
    assert.equal(overview.cost.unpricedModel, true)
    assert.equal((await scanner.scan({ rootDir: root })).scannedFiles, 0)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
