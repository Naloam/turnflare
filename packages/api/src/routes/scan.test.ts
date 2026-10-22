import { describe, expect, it } from 'vitest'
import type { Session } from '@turnflare/core'
import { loadConfig } from '../config.js'
import { FakeRepository } from '../test-support/fake-repository.js'
import {
  makeTestApp,
  parseData,
  readEnvelope,
  scanJobSchema,
  waitForScanJob,
  z,
} from '../test-support/test-app.js'
import type { ScanInput, ScanOutcome } from '../scanner/index.js'
import { createDefaultScannerFactory, type ScannerLike, type ScanProgressHooks } from './scan.js'

const DONE_OUTCOME: ScanOutcome = {
  totalFiles: 7,
  scannedFiles: 5,
  skippedFiles: 1,
  skippedEmpty: 1,
  failedFiles: 0,
  failures: [],
}

interface ScannerSpy {
  readonly scanner: ScannerLike
  readonly inputs: readonly ScanInput[]
}

/** 记录每次 scan 的入参，并按要求触发进度回调 */
function makeSpy(outcome: ScanOutcome, progress?: { done: number; total: number }): ScannerSpy {
  const inputs: ScanInput[] = []
  return {
    inputs,
    scanner: {
      scan(input: ScanInput, hooks?: ScanProgressHooks) {
        inputs.push(input)
        if (progress !== undefined) {
          hooks?.onProgress?.(progress.done, progress.total, '/tmp/x.jsonl')
        }
        return Promise.resolve(outcome)
      },
    },
  }
}

/** 一个不会自己结束的扫描器：用来验证"同一时刻只允许一个任务" */
function makeBlockingScanner(): {
  scanner: ScannerLike
  release: () => void
  started: Promise<void>
} {
  let release: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    started,
    release,
    scanner: {
      scan() {
        return started.then(() => DONE_OUTCOME)
      },
    },
  }
}

describe('POST /api/scan', () => {
  it('空请求体也能入队，rootDir 落到配置的数据根目录', async () => {
    // Arrange
    const spy = makeSpy(DONE_OUTCOME)
    const app = await makeTestApp({ scanner: spy.scanner, config: { dataRoot: '/data/root' } })

    try {
      // Act
      const response = await app.inject({ method: 'POST', url: '/api/scan' })

      // Assert
      expect(response.statusCode).toBe(200)
      const job = parseData(readEnvelope(response).data, scanJobSchema)
      expect(job.status).toBe('queued')
      expect(job.jobId.length).toBeGreaterThan(0)
      expect(job.finishedAt).toBeNull()
      expect(job.error).toBeNull()
      expect(spy.inputs).toHaveLength(1)
      expect(spy.inputs[0]?.rootDir).toBe('/data/root')
      expect(spy.inputs[0]?.force).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('请求体字段透传给扫描器', async () => {
    const spy = makeSpy(DONE_OUTCOME)
    const app = await makeTestApp({ scanner: spy.scanner })

    try {
      await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: {
          rootDir: '/data/projects',
          projectSlugs: ['-Users-a-b'],
          since: '2026-10-01T00:00:00.000Z',
          force: true,
        },
      })

      expect(spy.inputs[0]?.rootDir).toBe('/data/projects')
      expect(spy.inputs[0]?.projectSlugs).toEqual(['-Users-a-b'])
      expect(spy.inputs[0]?.force).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('非法请求体返回 400', async () => {
    const app = await makeTestApp()

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { force: 'yes' },
      })

      expect(response.statusCode).toBe(400)
      expect(readEnvelope(response).error).toContain('force')
    } finally {
      await app.close()
    }
  })

  it('畸形 JSON 体返回中文提示', async () => {
    const app = await makeTestApp()

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: '{"force": ',
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(400)
      expect(readEnvelope(response).error).toBe('请求体不是合法的 JSON')
    } finally {
      await app.close()
    }
  })

  it('扫描进行中重复提交返回 409', async () => {
    // Arrange
    const blocking = makeBlockingScanner()
    const app = await makeTestApp({ scanner: blocking.scanner })

    try {
      await app.inject({ method: 'POST', url: '/api/scan' })
      // Act：第一个任务还没结束
      const second = await app.inject({ method: 'POST', url: '/api/scan' })

      // Assert
      expect(second.statusCode).toBe(409)
      const envelope = readEnvelope(second)
      expect(envelope.success).toBe(false)
      expect(envelope.error).toContain('已有扫描任务')
    } finally {
      blocking.release()
      await app.close()
    }
  })

  it('扫描写库后列表能读到新会话', async () => {
    // Arrange：假扫描器模拟真实 Scanner 的落库动作
    const repo = new FakeRepository()
    const session: Session = {
      meta: {
        sessionId: '99999999-0000-4000-8000-000000000000',
        filePath: '/tmp/99999999.jsonl',
        projectSlug: '-Users-che1sy-Projects-zeta',
        cwd: '/Users/che1sy/Projects/zeta',
        gitBranch: 'main',
        cliVersion: '2.0.30',
        startedAt: '2026-10-19T08:00:00.000Z',
        endedAt: '2026-10-19T08:30:00.000Z',
        models: ['claude-opus-5-5'],
      },
      turns: [],
      records: [],
      parseErrors: [],
    }
    const app = await makeTestApp({
      repo,
      scanner: {
        scan() {
          repo.upsertSession(session, {
            filePath: session.meta.filePath,
            mtimeMs: 1,
            sizeBytes: 2,
          })
          return Promise.resolve({ ...DONE_OUTCOME, scannedFiles: 1, totalFiles: 1 })
        },
      },
    })

    try {
      const created = readEnvelope(await app.inject({ method: 'POST', url: '/api/scan' }))
      const jobId = parseData(created.data, scanJobSchema).jobId

      await waitForScanJob(app, jobId)

      const list = readEnvelope(await app.inject({ method: 'GET', url: '/api/sessions' }))
      const items = parseData(list.data, z.array(z.object({ sessionId: z.string() })))
      expect(items.map((item) => item.sessionId)).toContain(session.meta.sessionId)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/scan/:jobId', () => {
  it('任务完成后回报处理数与结束时间', async () => {
    // Arrange
    const spy = makeSpy(DONE_OUTCOME, { done: 3, total: 7 })
    const app = await makeTestApp({ scanner: spy.scanner })

    try {
      const created = readEnvelope(await app.inject({ method: 'POST', url: '/api/scan' }))
      const jobId = parseData(created.data, scanJobSchema).jobId

      // Act
      const envelope = await waitForScanJob(app, jobId)
      const job = parseData(envelope.data, scanJobSchema)

      // Assert
      expect(job.status).toBe('done')
      expect(job.totalFiles).toBe(7)
      expect(job.processedFiles).toBe(7)
      expect(job.finishedAt).not.toBeNull()
      expect(job.error).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('进度回调推进 processedFiles', async () => {
    // Arrange：scan 结束前先报一次进度，再放开
    const blocking = makeBlockingScanner()
    let progressSeen = 0
    const app = await makeTestApp({
      scanner: {
        scan(_input: ScanInput, hooks?: ScanProgressHooks) {
          hooks?.onProgress?.(4, 9, '/tmp/a.jsonl')
          progressSeen += 1
          return blocking.started.then(() => ({ ...DONE_OUTCOME, totalFiles: 9, scannedFiles: 9 }))
        },
      },
    })

    try {
      const created = readEnvelope(await app.inject({ method: 'POST', url: '/api/scan' }))
      const jobId = parseData(created.data, scanJobSchema).jobId
      // 让 scan 的第一段（含 onProgress）先跑完
      await Promise.resolve()

      const running = parseData(
        readEnvelope(await app.inject({ method: 'GET', url: `/api/scan/${jobId}` })).data,
        scanJobSchema,
      )
      expect(progressSeen).toBe(1)
      expect(running.processedFiles).toBe(4)
      expect(running.totalFiles).toBe(9)
    } finally {
      blocking.release()
      await app.close()
    }
  })

  it('扫描失败只把中文话术写进 job，不泄漏路径', async () => {
    // Arrange
    const app = await makeTestApp({
      scanner: {
        scan() {
          return Promise.reject(new Error('读取文件信息失败：/Users/che1sy/secret/dir/x.jsonl'))
        },
      },
    })

    try {
      const created = readEnvelope(await app.inject({ method: 'POST', url: '/api/scan' }))
      const jobId = parseData(created.data, scanJobSchema).jobId

      // Act
      const envelope = await waitForScanJob(app, jobId)
      const job = parseData(envelope.data, scanJobSchema)

      // Assert
      expect(job.status).toBe('failed')
      expect(job.error).toBe('扫描任务失败，请查看服务端日志')
      expect(job.error).not.toContain('/Users/che1sy')
      expect(job.finishedAt).not.toBeNull()
    } finally {
      await app.close()
    }
  })

  it('失败任务释放锁，后续可以再次提交', async () => {
    let attempts = 0
    const app = await makeTestApp({
      scanner: {
        scan() {
          attempts += 1
          return attempts === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(DONE_OUTCOME)
        },
      },
    })

    try {
      const first = parseData(
        readEnvelope(await app.inject({ method: 'POST', url: '/api/scan' })).data,
        scanJobSchema,
      )
      await waitForScanJob(app, first.jobId)

      const second = await app.inject({ method: 'POST', url: '/api/scan' })

      expect(second.statusCode).toBe(200)
      expect(attempts).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('未知任务 id 返回 404', async () => {
    const app = await makeTestApp()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/scan/does-not-exist' })

      expect(response.statusCode).toBe(404)
      expect(readEnvelope(response).error).toContain('未找到扫描任务')
    } finally {
      await app.close()
    }
  })

  it('空任务 id 返回 400', async () => {
    const app = await makeTestApp()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/scan/%20' })

      expect(response.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('扫描任务表隔离', () => {
  it('每个应用实例一份任务表', async () => {
    const first = await makeTestApp({ scanner: makeSpy(DONE_OUTCOME).scanner })
    const second = await makeTestApp({ scanner: makeSpy(DONE_OUTCOME).scanner })

    try {
      const jobId = parseData(
        readEnvelope(await first.inject({ method: 'POST', url: '/api/scan' })).data,
        scanJobSchema,
      ).jobId

      // 另一个实例的任务表里没有这个 id
      const response = await second.inject({ method: 'GET', url: `/api/scan/${jobId}` })
      expect(response.statusCode).toBe(404)
    } finally {
      await first.close()
      await second.close()
    }
  })
})

describe('createDefaultScannerFactory', () => {
  it('装配出能跑的 Scanner：扫不存在的目录也不抛错', async () => {
    // Arrange：走默认工厂（而不是注入替身），验证真实 Scanner 能被装配起来
    const scanner = createDefaultScannerFactory({
      repo: new FakeRepository(),
      config: loadConfig({ TURNFLARE_SCAN_CONCURRENCY: '2' }),
    })

    // Act
    const outcome = await scanner.scan({ rootDir: '/nonexistent-turnflare-dir' })

    // Assert：没有文件可扫，遍历失败被收敛进 failures 而不是抛出
    expect(outcome.totalFiles).toBe(0)
    expect(outcome.failedFiles).toBeGreaterThanOrEqual(0)
  })

  it('进度回调可注入', async () => {
    const scanner = createDefaultScannerFactory({
      repo: new FakeRepository(),
      config: loadConfig({}),
    })
    const seen: number[] = []

    await scanner.scan(
      { rootDir: '/nonexistent-turnflare-dir' },
      {
        onProgress: (done) => {
          seen.push(done)
        },
      },
    )

    // 空目录不会触发任何进度回调
    expect(seen).toEqual([])
  })
})
