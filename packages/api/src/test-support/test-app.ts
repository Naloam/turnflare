/**
 * 测试支撑：装配一个跑在内存 fake 仓储上的 Fastify 实例。
 *
 * 用 `app.inject` 打整条真实 HTTP 栈（路由、钩子、错误处理、序列化），
 * 但不监听端口——测试因此既贴近真实请求，又不会留下野进程。
 */

/** 测试环境写响应 schema 时统一从这里取 zod，免得每个测试文件各 import 一份 */
export { z } from 'zod'

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import type { AppConfig } from '../config.js'
import { buildApp } from '../server.js'
import type { ScannerFactory, ScannerLike } from '../routes/scan.js'
import type { ScanOutcome } from '../scanner/index.js'
import { FakeRepository } from './fake-repository.js'

/** 测试环境的固定数据根目录；不指向用户真实的 ~/.claude */
const TEST_DATA_ROOT = '/tmp/turnflare-test-data'

const EMPTY_SCAN_OUTCOME: ScanOutcome = {
  totalFiles: 0,
  scannedFiles: 0,
  skippedFiles: 0,
  skippedEmpty: 0,
  failedFiles: 0,
  failures: [],
}

/** 什么都不做的扫描器：路由测试不该真的碰磁盘 */
const NOOP_SCANNER: ScannerLike = {
  scan: () => Promise.resolve(EMPTY_SCAN_OUTCOME),
}

export interface TestAppOptions {
  readonly repo?: FakeRepository
  readonly config?: Partial<AppConfig>
  readonly scanner?: ScannerLike
}

export async function makeTestApp(options: TestAppOptions = {}): Promise<FastifyInstance> {
  const repo = options.repo ?? new FakeRepository()
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    TURNFLARE_DATA_ROOT: TEST_DATA_ROOT,
  })
  const scanner = options.scanner ?? NOOP_SCANNER
  const scannerFactory: ScannerFactory = () => scanner
  const app = buildApp({
    repo,
    config: { ...config, ...(options.config ?? {}) },
    scannerFactory,
    webRoot: `${TEST_DATA_ROOT}/unbuilt-web`,
  })
  await app.ready()
  return app
}

// ─── 响应读取 ────────────────────────────────────────────────────────────────

/** app.inject 的返回值里测试只用这两个字段 */
export interface InjectedResponse {
  readonly statusCode: number
  readonly payload: string
}

const metaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  generatedAt: z.string(),
})

/** 统一包络的形状；data 留 unknown，由各测试按需窄化 */
export const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z.string().nullable(),
  meta: metaSchema.optional(),
})

export type Envelope = z.infer<typeof envelopeSchema>

export const sessionListItemSchema = z.object({
  sessionId: z.string(),
  projectSlug: z.string(),
  cwd: z.string().nullable(),
  gitBranch: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  models: z.array(z.string()),
  turnCount: z.number(),
  usage: z.object({
    inputTokens: z.number(),
    cacheCreationTokens: z.number(),
    cacheReadTokens: z.number(),
    outputTokens: z.number(),
    thinkingTokens: z.number(),
    serverToolUse: z.number(),
  }),
  cost: z.object({
    inputCost: z.number(),
    outputCost: z.number(),
    cacheWriteCost: z.number(),
    cacheReadCost: z.number(),
    totalCost: z.number(),
    currency: z.string(),
    unpricedModel: z.boolean(),
    isEstimated: z.boolean(),
  }),
})

export const scanJobSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  totalFiles: z.number(),
  processedFiles: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
})

/** 解析响应体；结构不符就让测试直接红，而不是拿到 undefined 后莫名失败 */
export function readEnvelope(response: InjectedResponse): Envelope {
  const parsed: unknown = JSON.parse(response.payload)
  const result = envelopeSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`响应不符合统一包络：${result.error.message}`)
  }
  return result.data
}

/** 用 schema 窄化包络里的 data；断言失败信息里带上 schema 的原因 */
export function parseData<T>(data: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new Error(`响应 data 不符合预期：${result.error.message}`)
  }
  return result.data
}

const POLL_INTERVAL_MS = 5
const MAX_POLL_ATTEMPTS = 100

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 轮询直到扫描任务离开 queued / running；超时即失败 */
export async function waitForScanJob(app: FastifyInstance, jobId: string): Promise<Envelope> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const envelope = readEnvelope(await app.inject({ method: 'GET', url: `/api/scan/${jobId}` }))
    const job = parseData(envelope.data, scanJobSchema)
    if (job.status !== 'queued' && job.status !== 'running') {
      return envelope
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`扫描任务 ${jobId} 未在预期时间内完成`)
}
