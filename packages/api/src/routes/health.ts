/**
 * @turnflare/api —— 健康检查路由。
 *
 * 除探活外还承担"确认数据根目录"的职责：调用方看一眼 dataRoot 与 lastScanAt
 * 就知道服务指向哪份数据、最近一次扫描是什么时候，不必翻服务端日志。
 */

import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import type { SessionRepository } from '../db/repository.js'
import { sendData } from './envelope.js'
import type { HealthPayload } from '../types.js'

/** 路由共用的依赖；各路由按需取用，避免一个巨型 deps 对象 */
export interface HealthRouteDeps {
  readonly repo: SessionRepository
  readonly config: AppConfig
}

const SERVICE_NAME = 'turnflare'

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get('/api/health', async (request, reply) => {
    const payload: HealthPayload = {
      name: SERVICE_NAME,
      version: deps.config.version,
      dataRoot: deps.config.dataRoot,
      sessionCount: deps.repo.countSessions(),
      lastScanAt: deps.repo.getLastScanAt(),
    }
    request.log.debug('健康检查')
    return sendData(reply, payload)
  })
}
