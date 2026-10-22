/** Launch the actual packaged binary, including its own runtime, SQLite, migrations and assets. */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSampleRoot } from './sample-data.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = mkdtempSync(path.join(tmpdir(), 'turnflare-desktop-smoke-'))
const sample = createSampleRoot()
const executablePath =
  process.argv[2] ??
  path.join(
    root,
    'release/desktop',
    process.platform === 'darwin'
      ? `mac${process.arch === 'arm64' ? '-arm64' : ''}/Turnflare.app/Contents/MacOS/Turnflare`
      : 'win-unpacked/Turnflare.exe',
  )
let application
async function launch(initialRoot) {
  application = await electron.launch({
    executablePath,
    timeout: 30000,
    env: {
      ...process.env,
      TURNFLARE_DESKTOP_USER_DATA: directory,
      TURNFLARE_DESKTOP_DATA_ROOT: initialRoot ?? '',
    },
  })
  const page = await application.firstWindow()
  await page.getByTestId('desktop-controls').waitFor({ timeout: 30000 })
  return page
}
try {
  let page = await launch(sample)
  assert.equal(page.url().startsWith('turnflare://app/'), true)
  const state = await page.evaluate(() => window.turnflareDesktop.getState())
  assert.equal(state.sessionCount, 9)
  assert.equal(state.mode, 'local')
  const status = await page.evaluate(
    async () => (await (await fetch('/api/health')).json()).data.sessionCount,
  )
  assert.equal(status, 9)
  const scan = await page.evaluate(
    async () => (await fetch('/api/scan', { method: 'POST' })).status,
  )
  assert.equal(scan, 200)
  await page.evaluate(() => {
    localStorage.setItem('turnflare-language', 'en')
  })
  await page.reload()
  await page.getByRole('button', { name: 'Try examples' }).click()
  await page.getByText('Example mode', { exact: true }).waitFor()
  const denied = await page.evaluate(
    async () => (await fetch('/api/scan', { method: 'POST', body: '{}' })).status,
  )
  assert.equal(denied, 403)
  await page.getByRole('button', { name: 'Back to local history' }).click()
  await page.getByText('Local history', { exact: true }).waitFor()
  await page.goto('turnflare://app/#/sessions')
  await page.getByTestId('session-row').first().waitFor()
  await page.getByTestId('session-row').first().click()
  await page.getByTestId('turn-item').first().waitFor()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('https://example.com')
        return false
      } catch {
        return true
      }
    }),
    true,
  )
  await page.screenshot({
    path: path.join(root, `release/desktop-smoke-${process.platform}-${process.arch}.png`),
  })
  // Verify the renderer-to-main save capability in the packaged application.
  await page.goto('turnflare://app/#/analytics')
  await page.getByText('Tool activity', { exact: true }).waitFor()
  await page.getByLabel('Scope').selectOption('side')
  await page.getByLabel('Report format').selectOption('json')
  await page.getByRole('button', { name: 'Export selected data' }).waitFor({ state: 'visible' })
  const savedReport = path.join(directory, 'filtered-report.json')
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, savedReport)
  await page.getByRole('button', { name: 'Export selected data' }).click()
  await page.getByText('Report saved', { exact: true }).waitFor()
  const report = JSON.parse(readFileSync(savedReport, 'utf8')).data
  assert.equal(report.filters.chain, 'side')
  const analytics = await page.evaluate(
    async () => (await (await fetch('/api/stats/analytics?chain=side')).json()).data,
  )
  assert.equal(report.overview.cost.totalCost, analytics.cost.totalCost)
  await application.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  assert.equal(
    await page.evaluate(() => window.turnflareDesktop.saveReport('csv', { chain: 'main' })),
    false,
  )
  const invalidSave = await page.evaluate(async () => {
    try {
      await window.turnflareDesktop.saveReport('exe', {})
      return false
    } catch {
      return true
    }
  })
  assert.equal(invalidSave, true)
  const selectedFolder = path.join(directory, 'another-history')
  mkdirSync(selectedFolder)
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, selectedFolder)
  await page.getByRole('button', { name: 'Choose history folder' }).click()
  await page.getByText(selectedFolder, { exact: true }).waitFor()
  await page
    .getByText('No sessions found. Choose your history folder above, or try the examples.', {
      exact: true,
    })
    .waitFor()
  await application.close()
  application = undefined
  page = await launch()
  await page.getByRole('button', { name: 'Choose history folder' }).waitFor()
  const restored = await page.evaluate(() => window.turnflareDesktop.getState())
  assert.equal(restored.dataRoot, selectedFolder)
  assert.equal(restored.sessionCount, 0)
  assert.equal(
    JSON.parse(readFileSync(path.join(directory, 'settings.json'), 'utf8')).dataRoot,
    selectedFolder,
  )
  assert.equal(existsSync(path.join(directory, 'indexes')), true)
  console.log(
    `Packaged desktop verified on ${process.platform}/${process.arch}: SQLite, assets, history, demo, navigation, isolation and persisted preferences.`,
  )
} finally {
  await application?.close()
  rmSync(directory, { recursive: true, force: true })
  rmSync(sample, { recursive: true, force: true })
}
