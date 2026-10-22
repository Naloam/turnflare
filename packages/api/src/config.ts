import os from 'node:os'
import path from 'node:path'

/**
 * 运行时配置。
 *
 * 所有配置来自环境变量，启动时一次性读取并校验——缺失必填项立即失败，
 * 不让错误配置流入请求处理阶段。
 */

export interface AppConfig {
  readonly port: number
  readonly host: string
  readonly dataRoot: string
  readonly dbPath: string
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  readonly corsOrigins: readonly string[]
  readonly maxFileBytes: number
  readonly scanConcurrency: number
  readonly version: string
  /** Zero disables live indexing. */
  readonly watchIntervalMs?: number
}

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const DEFAULT_SCAN_CONCURRENCY = 4

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigError(`PORT 必须是 1-65535 的整数，当前值：${raw}`)
  }
  return parsed
}

function readPositiveInt(raw: string | undefined, fallback: number, field: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigError(`${field} 必须是正整数，当前值：${raw}`)
  }
  return parsed
}

function readLogLevel(raw: string | undefined): AppConfig['logLevel'] {
  if (raw === undefined || raw.trim() === '') {
    return 'info'
  }
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new ConfigError(`LOG_LEVEL 必须是 ${LOG_LEVELS.join(' / ')} 之一，当前值：${raw}`)
  }
  return raw as AppConfig['logLevel']
}

function readOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') {
    return ['http://localhost:5173', 'http://127.0.0.1:5173']
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * 默认数据根目录。
 *
 * 必须读**传入的 env** 而不是 process.env：否则 loadConfig(env) 的可注入性
 * 形同虚设，测试与 CLI 想覆盖配置时会被进程环境变量悄悄盖掉。
 */
function defaultDataRoot(env: NodeJS.ProcessEnv): string {
  return env.TURNFLARE_DATA_ROOT ?? path.join(os.homedir(), '.claude', 'projects')
}

/** 默认数据库路径；`:memory:` 原样返回，交给 better-sqlite3 处理 */
function defaultDbPath(env: NodeJS.ProcessEnv): string {
  return env.TURNFLARE_DB ?? path.join(os.homedir(), '.turnflare', 'turnflare.db')
}

/** 从给定环境读取配置；配置非法时抛 ConfigError */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const watchIntervalMs = Number(env.TURNFLARE_WATCH_INTERVAL_MS ?? 0)
  if (!Number.isSafeInteger(watchIntervalMs) || (watchIntervalMs !== 0 && watchIntervalMs < 1000)) {
    throw new ConfigError('TURNFLARE_WATCH_INTERVAL_MS must be 0 or an integer of at least 1000')
  }
  return {
    watchIntervalMs,
    port: readPort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    dataRoot: defaultDataRoot(env),
    dbPath: defaultDbPath(env),
    logLevel: readLogLevel(env.LOG_LEVEL),
    corsOrigins: readOrigins(env.TURNFLARE_CORS_ORIGINS),
    maxFileBytes: readPositiveInt(
      env.TURNFLARE_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES,
      'TURNFLARE_MAX_FILE_BYTES',
    ),
    scanConcurrency: readPositiveInt(
      env.TURNFLARE_SCAN_CONCURRENCY,
      DEFAULT_SCAN_CONCURRENCY,
      'TURNFLARE_SCAN_CONCURRENCY',
    ),
    version: env.TURNFLARE_VERSION ?? '0.2.1',
  }
}
