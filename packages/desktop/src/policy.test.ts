import { expect, it } from 'vitest'
import { isAppUrl, readSavedFolder, indexFileName, reportRequest } from './policy.js'

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

it('restricts report IPC to known formats and query keys, never a renderer supplied path', () => {
  expect(reportRequest('csv', { chain: 'side', project: 'a&rootDir=/etc' })).toEqual({
    url: '/api/report?format=csv&chain=side&project=a%26rootDir%3D%2Fetc',
    extension: 'csv',
  })
  expect(reportRequest('markdown', {})?.extension).toBe('md')
  for (const [format, filters] of [
    ['exe', {}],
    ['html', null],
    ['csv', { rootDir: '/etc' }],
    ['json', { chain: [] }],
  ]) {
    expect(reportRequest(format, filters)).toBeNull()
  }
})
