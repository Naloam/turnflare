import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCliProgress, createRecordingProgress, createSilentProgress } from './progress.js'
import { createShutdownWaiter, listenWithFastify, writeFileWithFs } from './deps.js'
import { createCollectingStream } from './test-support/streams.js'

describe('progress：进度上报', () => {
  it('静音实现什么都不做', () => {
    const reporter = createSilentProgress()
    expect(() => {
      reporter.advance(1, 2)
      reporter.stop()
    }).not.toThrow()
  })

  it('记录型实现把每次上报收进数组', () => {
    const { reporter, events } = createRecordingProgress()
    reporter.advance(1, 4)
    reporter.advance(2, 4)
    reporter.stop()
    expect(events).toEqual(['1/4', '2/4', 'stop'])
  })

  it('cli-progress 实现：一条进度条跑到底，不重建、不重置总数', () => {
    // Arrange：cli-progress 的重绘节奏由它自己的定时器管，
    // 测试只管"往前走时间"，不断言它什么时候重绘。
    vi.useFakeTimers()
    try {
      const collector = createCollectingStream()
      const reporter = createCliProgress(collector.stream)

      // Act
      reporter.advance(1, 3)
      vi.advanceTimersByTime(50)
      reporter.advance(2, 3)
      vi.advanceTimersByTime(50)
      reporter.stop()

      // Assert
      const output = collector.text()
      expect(output).toContain('扫描进度')
      expect(output).toContain('2/3')
      // 光标保存（ESC 7）只发生在 start()：出现两次就说明进度条被重建了
      expect(output.split('\u001b7').length - 1).toBe(1)
      // 总数始终是 3，没有被后来的文件改成别的值
      expect(output).not.toContain('0/2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cli-progress 实现：stop 之后可以重新开始一轮', () => {
    // Arrange
    vi.useFakeTimers()
    try {
      const collector = createCollectingStream()
      const reporter = createCliProgress(collector.stream)

      // Act
      reporter.advance(1, 1)
      vi.advanceTimersByTime(50)
      reporter.stop()
      reporter.advance(1, 2)
      vi.advanceTimersByTime(50)
      reporter.stop()

      // Assert：新一轮是一个新条形图（两次光标保存），总数换成 2
      const output = collector.text()
      expect(output.split('\u001b7').length - 1).toBe(2)
      expect(output).toContain('0/2')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deps：真实世界的那几个实现', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'turnflare-cli-deps-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writeFileWithFs 真的把内容写进磁盘', () => {
    // Arrange
    const target = join(dir, 'report.md')

    // Act
    writeFileWithFs(target, '# Turnflare')

    // Assert
    expect(readFileSync(target, 'utf8')).toBe('# Turnflare')
  })

  it('listenWithFastify 返回地址并在 close 时关闭服务', async () => {
    // Arrange：一个满足最小形状的假 Fastify
    const events: string[] = []
    const app = {
      listen: () => {
        events.push('listen')
        return Promise.resolve('http://127.0.0.1:1234')
      },
      close: () => {
        events.push('close')
        return Promise.resolve()
      },
    }
    const config = {
      port: 1234,
      host: '127.0.0.1',
      dataRoot: '/tmp',
      dbPath: '/tmp/x.db',
      logLevel: 'info',
      corsOrigins: [],
      maxFileBytes: 1,
      scanConcurrency: 1,
      version: '0.1.0',
    } as const

    // Act
    const handle = await listenWithFastify(app, config)
    expect(handle.url).toBe('http://127.0.0.1:1234')
    await handle.close()

    // Assert
    expect(events).toEqual(['listen', 'close'])
  })

  it('createShutdownWaiter 在 SIGINT 时 resolve', async () => {
    // Arrange
    const bus = new EventEmitter()
    const waiter = createShutdownWaiter(bus)
    let resolved = false
    const pending = waiter().then(() => {
      resolved = true
    })

    // Act
    bus.emit('SIGINT')
    await pending

    // Assert
    expect(resolved).toBe(true)
    expect(bus.listenerCount('SIGINT')).toBe(0)
    expect(bus.listenerCount('SIGTERM')).toBe(0)
  })

  it('createShutdownWaiter 也认 SIGTERM，且不重复触发', async () => {
    // Arrange
    const bus = new EventEmitter()
    const waiter = createShutdownWaiter(bus)
    let count = 0
    const pending = waiter().then(() => {
      count += 1
    })

    // Act
    bus.emit('SIGTERM')
    bus.emit('SIGINT')
    await pending

    // Assert
    expect(count).toBe(1)
  })
})
