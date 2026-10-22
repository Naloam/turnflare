import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * SQLite 连接与迁移运行。
 *
 * 迁移文件命名约定：`NNN_description.sql`，按序号升序执行，
 * 已执行的版本记录在 `schema_migrations` 表中，不会重复执行。
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

const MIGRATION_PATTERN = /^(\d+)_.*\.sql$/

export interface MigrationResult {
  readonly applied: number
  readonly versions: readonly number[]
}

/** 读取并排序迁移文件，返回 [{ version, filePath }] */
export function listMigrations(migrationsDir: string = MIGRATIONS_DIR): {
  version: number
  filePath: string
}[] {
  const entries = readdirSync(migrationsDir)
  const migrations = entries
    .map((fileName) => {
      const match = MIGRATION_PATTERN.exec(fileName)
      if (!match) {
        return null
      }
      return {
        version: Number(match[1]),
        filePath: path.join(migrationsDir, fileName),
      }
    })
    .filter((entry): entry is { version: number; filePath: string } => entry !== null)
    .sort((a, b) => a.version - b.version)

  const versions = migrations.map((m) => m.version)
  if (new Set(versions).size !== versions.length) {
    throw new Error(`迁移文件版本号重复：${versions.join(', ')}`)
  }

  return migrations
}

/**
 * 执行所有未应用的迁移。
 *
 * 整个迁移过程包在一个事务里：任一迁移失败则全部回滚，
 * 不会留下"应用了一半"的 schema。
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = MIGRATIONS_DIR,
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT    NOT NULL
    );
  `)

  const appliedVersions = new Set(
    db
      .prepare<[], { version: number }>('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  )

  const pending = listMigrations(migrationsDir).filter((m) => !appliedVersions.has(m.version))

  if (pending.length === 0) {
    return { applied: 0, versions: [] }
  }

  const appliedNow: number[] = []

  const migrateAll = db.transaction(() => {
    for (const migration of pending) {
      const sql = readFileSync(migration.filePath, 'utf8')
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
      appliedNow.push(migration.version)
    }
  })

  migrateAll()

  return { applied: appliedNow.length, versions: appliedNow }
}

/** 打开（必要时创建）数据库并完成迁移 */
export function openDatabase(
  dbPath: string,
  migrationsDir: string = MIGRATIONS_DIR,
): { db: Database.Database; appliedMigrations: number } {
  // better-sqlite3 不会创建父目录，默认路径 ~/.turnflare/ 首次运行必然不存在。
  // 在这里补建，比让使用者在文档里找"请手动 mkdir"要好。
  if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
    const parentDir = path.dirname(dbPath)
    if (parentDir && parentDir !== '.') {
      mkdirSync(parentDir, { recursive: true })
    }
  }

  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  const result = runMigrations(db, migrationsDir)

  return { db, appliedMigrations: result.applied }
}
