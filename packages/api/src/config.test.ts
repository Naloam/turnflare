import { describe, expect, test } from 'vitest'
import { ConfigError, loadConfig } from './config.js'

/**
 * config.ts 是环境变量接线的唯一入口，却是 api 包里覆盖率最低的源文件
 * （分支 67.85%）。这些测试把每条校验路径都钉住：配置错误必须在启动时
 * 就炸出来，不能流到请求处理阶段才以 500 的形式出现。
 */

describe('loadConfig 的默认值', () => {
  test('空环境给出全部默认值', () => {
    const config = loadConfig({})

    expect(config.port).toBe(8787)
    expect(config.host).toBe('127.0.0.1')
    expect(config.logLevel).toBe('info')
    expect(config.maxFileBytes).toBe(50 * 1024 * 1024)
    expect(config.scanConcurrency).toBe(4)
    expect(config.version).toBe('0.1.0')
    expect(config.dbPath).toContain('.turnflare')
    expect(config.dataRoot).toContain('.claude')
  })

  test('空串按未提供处理，不报错', () => {
    const config = loadConfig({ PORT: '', HOST: '', LOG_LEVEL: '' })

    expect(config.port).toBe(8787)
    expect(config.host).toBe('127.0.0.1')
    expect(config.logLevel).toBe('info')
  })

  test('HOST 只有空白时回退默认值', () => {
    expect(loadConfig({ HOST: '   ' }).host).toBe('127.0.0.1')
  })
})

describe('loadConfig 的环境变量覆盖', () => {
  test('显式值全部生效', () => {
    const config = loadConfig({
      PORT: '9000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'debug',
      TURNFLARE_DB: '/data/custom.db',
      TURNFLARE_DATA_ROOT: '/data/sessions',
      TURNFLARE_MAX_FILE_BYTES: '1024',
      TURNFLARE_SCAN_CONCURRENCY: '8',
      TURNFLARE_VERSION: '9.9.9',
    })

    expect(config.port).toBe(9000)
    expect(config.host).toBe('0.0.0.0')
    expect(config.logLevel).toBe('debug')
    expect(config.dbPath).toBe('/data/custom.db')
    expect(config.dataRoot).toBe('/data/sessions')
    expect(config.maxFileBytes).toBe(1024)
    expect(config.scanConcurrency).toBe(8)
    expect(config.version).toBe('9.9.9')
  })

  test('CORS 来源按逗号拆分并去空白', () => {
    const config = loadConfig({
      TURNFLARE_CORS_ORIGINS: 'http://a.test, http://b.test ,,http://c.test',
    })
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test', 'http://c.test'])
  })

  test('CORS 未提供时给本地开发默认源', () => {
    const config = loadConfig({})
    expect(config.corsOrigins).toContain('http://localhost:5173')
    expect(config.corsOrigins).toContain('http://127.0.0.1:5173')
  })

  test('TURNFLARE_DB 支持 :memory:', () => {
    expect(loadConfig({ TURNFLARE_DB: ':memory:' }).dbPath).toBe(':memory:')
  })
})

describe('loadConfig 的参数校验', () => {
  test.each(['-1', '999', '1000.5', 'NaN', 'Infinity', '9007199254740992'])(
    'live indexing rejects invalid interval %s',
    (value) => {
      expect(() => loadConfig({ TURNFLARE_WATCH_INTERVAL_MS: value })).toThrow(ConfigError)
    },
  )

  test('live indexing is opt-in for the API and accepts the minimum interval', () => {
    expect(loadConfig({}).watchIntervalMs).toBe(0)
    expect(loadConfig({ TURNFLARE_WATCH_INTERVAL_MS: '0' }).watchIntervalMs).toBe(0)
    expect(loadConfig({ TURNFLARE_WATCH_INTERVAL_MS: '1000' }).watchIntervalMs).toBe(1000)
  })

  test.each(['0', '-1', '65536', 'abc', '80.5', 'NaN'])('PORT 拒绝 %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(ConfigError)
  })

  test('PORT 的上边界 65535 与下边界 1 都合法', () => {
    expect(loadConfig({ PORT: '1' }).port).toBe(1)
    expect(loadConfig({ PORT: '65535' }).port).toBe(65535)
  })

  test.each(['verbose', 'INFO', 'warn ', 'trace '])('LOG_LEVEL 拒绝 %j', (level) => {
    // 大小写敏感且不接受空白：日志级别写错的代价是排错时看不到细节
    expect(() => loadConfig({ LOG_LEVEL: level })).toThrow(ConfigError)
  })

  test.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])('LOG_LEVEL 接受 %s', (level) => {
    expect(loadConfig({ LOG_LEVEL: level }).logLevel).toBe(level)
  })

  test.each(['0', '-5', 'abc', '1.5'])('TURNFLARE_MAX_FILE_BYTES 拒绝 %s', (value) => {
    expect(() => loadConfig({ TURNFLARE_MAX_FILE_BYTES: value })).toThrow(ConfigError)
  })

  test.each(['0', '-1', 'abc'])('TURNFLARE_SCAN_CONCURRENCY 拒绝 %s', (value) => {
    expect(() => loadConfig({ TURNFLARE_SCAN_CONCURRENCY: value })).toThrow(ConfigError)
  })

  test('错误信息里带出字段名与当前值', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT.*abc/)
  })

  test('ConfigError 的名字可被 instanceof 之外的判断利用', () => {
    try {
      loadConfig({ PORT: 'abc' })
      expect.unreachable('应当抛出')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as Error).name).toBe('ConfigError')
    }
  })
})

describe('loadConfig 不读 process.env', () => {
  test('传入的 env 完全决定结果', () => {
    // 这条守的是一个已经踩过的坑：defaultDataRoot/defaultDbPath 曾经直接读
    // process.env，于是 loadConfig(env) 的可注入性形同虚设——测试与 CLI
    // 想覆盖配置时会被进程环境变量悄悄盖掉。
    const previous = process.env.TURNFLARE_DB
    process.env.TURNFLARE_DB = '/from/process/env.db'
    try {
      const config = loadConfig({ TURNFLARE_DB: '/from/argument.db' })
      expect(config.dbPath).toBe('/from/argument.db')
    } finally {
      if (previous === undefined) {
        delete process.env.TURNFLARE_DB
      } else {
        process.env.TURNFLARE_DB = previous
      }
    }
  })
})
