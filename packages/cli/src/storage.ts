/**
 * 数据库定位、配置读取与连接管理。
 *
 * 三条规则：
 *   1. 路径只来自 `TURNFLARE_DB` 或 api 包的默认值（`~/.turnflare/turnflare.db`），
 *      不在 CLI 里重复一份路径规则；
 *   2. 内存库（`:memory:` / `file::memory:`）跳过存在性检查，否则测试无法运行；
 *   3. 打开失败一律收敛成中文可读错误，调用方转成 exitCode 1。
 *
 * 读类命令要求库文件已存在（没扫过就该提示去扫），写类命令（scan）则允许新建，
 * 这个差异用 `requireExisting` 一个开关表达。
 */
import { existsSync } from 'node:fs'
import type {
  AppConfig,
  CreateRepositoryFn,
  LoadConfigFn,
  OpenDatabaseFn,
  SessionRepository,
  SqliteDatabase,
} from './api-types.js'

/** 内存库：better-sqlite3 的两种写法 */
export function isInMemoryDatabase(dbPath: string): boolean {
  return dbPath === ':memory:' || dbPath.startsWith('file::memory:')
}

/** `TURNFLARE_DB` 优先，否则用 api 配置给出的默认路径 */
export function resolveDatabasePath(env: NodeJS.ProcessEnv, configuredPath: string): string {
  const override = env.TURNFLARE_DB
  return override !== undefined && override.trim() !== '' ? override : configuredPath
}

export interface StorageDeps {
  readonly loadConfig: LoadConfigFn
  readonly openDatabase: OpenDatabaseFn
  readonly createRepository: CreateRepositoryFn
}

export type StorageResult =
  | {
      readonly kind: 'ok'
      readonly db: SqliteDatabase
      readonly repo: SessionRepository
      readonly dbPath: string
      readonly config: AppConfig
    }
  | { readonly kind: 'missing'; readonly dbPath: string }
  | { readonly kind: 'error'; readonly message: string }

/** 读 api 配置；配置非法（例如 PORT 写错）时报中文错误 */
function readConfig(env: NodeJS.ProcessEnv, deps: StorageDeps): AppConfig | string {
  try {
    return deps.loadConfig(env)
  } catch (error: unknown) {
    return `配置无效：${toReason(error)}`
  }
}

/**
 * 读配置 → 定位数据库 → 打开连接 → 装配仓储。
 *
 * 四步合成一个入口，是因为六个命令都要走同一条路；各自拼装就会出现
 * "有的命令忘了关连接""有的命令忘了建目录"这种不一致。
 */
export function openStorageFromEnv(
  env: NodeJS.ProcessEnv,
  deps: StorageDeps,
  options?: { readonly requireExisting?: boolean },
): StorageResult {
  const config = readConfig(env, deps)
  if (typeof config === 'string') {
    return { kind: 'error', message: config }
  }

  const dbPath = resolveDatabasePath(env, config.dbPath)
  const requireExisting = options?.requireExisting ?? false
  if (requireExisting && !isInMemoryDatabase(dbPath) && !existsSync(dbPath)) {
    return { kind: 'missing', dbPath }
  }

  try {
    const opened = deps.openDatabase(dbPath)
    return {
      kind: 'ok',
      db: opened.db,
      repo: deps.createRepository(opened.db),
      dbPath,
      config,
    }
  } catch (error: unknown) {
    return { kind: 'error', message: `无法打开数据库：${dbPath}（${toReason(error)}）` }
  }
}

/** 把 unknown 异常收敛成一句可读原因 */
export function toReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 关闭连接；失败只影响进程退出，不值得让命令失败 */
export function closeStorage(db: SqliteDatabase | null): void {
  if (db === null) {
    return
  }
  try {
    db.close()
  } catch {
    // 进程随即退出，关闭失败的唯一后果是 WAL 未 checkpoint
  }
}
