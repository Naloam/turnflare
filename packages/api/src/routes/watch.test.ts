import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeTestApp } from '../test-support/test-app.js'

describe('incremental live scanning', () => {
  let app: FastifyInstance | undefined
  afterEach(async () => {
    await app?.close()
    vi.useRealTimers()
  })

  it('runs at the configured interval and stops when the app closes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const scan = vi.fn().mockResolvedValue({
      totalFiles: 0,
      scannedFiles: 0,
      skippedFiles: 0,
      skippedEmpty: 0,
      failedFiles: 0,
      failures: [],
    })
    app = await makeTestApp({ scanner: { scan }, config: { watchIntervalMs: 1000 } })
    await vi.advanceTimersByTimeAsync(2100)
    expect(scan).toHaveBeenCalledTimes(2)
    await app.close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('shares the queue with manual scans and skips overlapping ticks', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let release: () => void = () => undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const scan = vi.fn(() =>
      blocked.then(() => ({
        totalFiles: 0,
        scannedFiles: 0,
        skippedFiles: 0,
        skippedEmpty: 0,
        failedFiles: 0,
        failures: [],
      })),
    )
    app = await makeTestApp({ scanner: { scan }, config: { watchIntervalMs: 1000 } })
    await vi.advanceTimersByTimeAsync(3100)
    expect(scan).toHaveBeenCalledTimes(1)
    const response = await app.inject({ method: 'POST', url: '/api/scan', payload: {} })
    expect(response.statusCode).toBe(409)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(scan).toHaveBeenCalledTimes(2)
  })
})
