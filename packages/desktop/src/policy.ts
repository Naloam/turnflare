import { createHash } from 'node:crypto'
import path from 'node:path'

export function isAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'turnflare:' &&
      url.hostname === 'app' &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

export function readSavedFolder(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || !('dataRoot' in parsed)) return undefined
    return typeof parsed.dataRoot === 'string' && path.isAbsolute(parsed.dataRoot)
      ? parsed.dataRoot
      : undefined
  } catch {
    return undefined
  }
}

export function indexFileName(dataRoot: string): string {
  return `${createHash('sha256').update(path.resolve(dataRoot)).digest('hex').slice(0, 24)}.db`
}
