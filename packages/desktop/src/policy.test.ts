import { expect, it } from 'vitest'
import { isAppUrl, readSavedFolder, indexFileName } from './policy.js'

it('accepts only the application origin for navigation and privileged calls', () => {
  expect(isAppUrl('turnflare://app/#/overview')).toBe(true)
  for (const url of [
    'https://github.com',
    'file:///etc/passwd',
    'turnflare://other/',
    'turnflare://app.evil/',
    'turnflare://user@app/',
    'not a URL',
  ]) {
    expect(isAppUrl(url)).toBe(false)
  }
})

it('accepts only absolute persisted folders and gives every root a stable safe index name', () => {
  expect(readSavedFolder('{"dataRoot":"relative"}')).toBeUndefined()
  expect(readSavedFolder('not json')).toBeUndefined()
  expect(readSavedFolder('{"dataRoot":5}')).toBeUndefined()
  const root = process.platform === 'win32' ? 'C:\\history' : '/history'
  expect(readSavedFolder(JSON.stringify({ dataRoot: root }))).toBe(root)
  expect(indexFileName(root)).toMatch(/^[a-f0-9]{24}\.db$/)
  expect(indexFileName(root)).not.toBe(indexFileName(root + '-other'))
})
