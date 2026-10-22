import { describe, expect, it } from 'vitest'
import {
  parseJobId,
  parseReportFormat,
  parseScanBody,
  parseSessionId,
  parseSessionsQuery,
  parseTimelineQuery,
} from './index.js'

describe('parseSessionsQuery', () => {
  it('默认分页与排序', () => {
    // Arrange / Act
    const result = parseSessionsQuery({})

    // Assert
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toEqual({ page: 1, limit: 50, sort: 'cost', order: 'desc' })
  })

  it('数字型查询参数从字符串 coerce', () => {
    const result = parseSessionsQuery({ page: '3', limit: '20' })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.page).toBe(3)
    expect(result.value.limit).toBe(20)
  })

  it('保留可选过滤条件', () => {
    const result = parseSessionsQuery({ project: '-Users-a-b', model: 'claude-opus-5-5' })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.project).toBe('-Users-a-b')
    expect(result.value.model).toBe('claude-opus-5-5')
  })

  it('page 小于 1 时报字段名', () => {
    const result = parseSessionsQuery({ page: '0' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('page')
    expect(result.error).toContain('整数')
  })

  it('limit 超过 200 时拒绝', () => {
    const result = parseSessionsQuery({ limit: '201' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('limit')
  })

  it('limit 不是数字时拒绝', () => {
    const result = parseSessionsQuery({ limit: 'abc' })

    expect(result.ok).toBe(false)
  })

  it('sort 不在白名单内时拒绝并列出合法值', () => {
    const result = parseSessionsQuery({ sort: 'size' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toBe('参数 sort 必须是 cost/tokens/recent/turns 之一')
  })

  it('order 不在白名单内时拒绝', () => {
    const result = parseSessionsQuery({ order: 'sideways' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toBe('参数 order 必须是 asc/desc 之一')
  })
})

describe('parseTimelineQuery', () => {
  it('默认按天分桶', () => {
    const result = parseTimelineQuery({})

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toEqual({ granularity: 'day' })
  })

  it('接受 hour 粒度与时间范围', () => {
    const result = parseTimelineQuery({
      granularity: 'hour',
      since: '2026-10-01',
      until: '2026-10-19T00:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.granularity).toBe('hour')
    expect(result.value.since).toBe('2026-10-01')
    expect(result.value.until).toBe('2026-10-19T00:00:00.000Z')
  })

  it('since 不是时间时拒绝', () => {
    const result = parseTimelineQuery({ since: '昨天' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('since')
    expect(result.error).toContain('ISO')
  })

  it('granularity 不合法时拒绝', () => {
    const result = parseTimelineQuery({ granularity: 'week' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toBe('参数 granularity 必须是 hour/day 之一')
  })
})

describe('parseScanBody', () => {
  it('空请求体等同全部默认值', () => {
    const result = parseScanBody(undefined)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toEqual({ force: false })
  })

  it('解析全部字段', () => {
    const result = parseScanBody({
      rootDir: '/data/projects',
      projectSlugs: ['-Users-a-b'],
      since: '2026-10-01T00:00:00.000Z',
      force: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value.rootDir).toBe('/data/projects')
    expect(result.value.projectSlugs).toEqual(['-Users-a-b'])
    expect(result.value.force).toBe(true)
  })

  it('force 传非布尔值时拒绝', () => {
    const result = parseScanBody({ force: 'yes' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('force')
  })

  it('projectSlugs 传标量时拒绝', () => {
    const result = parseScanBody({ projectSlugs: '-Users-a-b' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('projectSlugs')
  })

  it('rootDir 为空串时拒绝', () => {
    const result = parseScanBody({ rootDir: '   ' })

    expect(result.ok).toBe(false)
  })
})

describe('parseReportFormat', () => {
  it('接受四种格式', () => {
    for (const format of ['json', 'markdown', 'csv', 'html']) {
      expect(parseReportFormat({ format }).ok).toBe(true)
    }
  })

  it('未知格式拒绝并列出合法值', () => {
    const result = parseReportFormat({ format: 'pdf' })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toBe('参数 format 必须是 json/markdown/csv/html 之一')
  })

  it('缺 format 时拒绝', () => {
    expect(parseReportFormat({}).ok).toBe(false)
  })
})

describe('parseSessionId', () => {
  it('接受完整 id 与前缀', () => {
    const result = parseSessionId({ id: '431c03a5' })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toBe('431c03a5')
  })

  it('空 id 拒绝', () => {
    expect(parseSessionId({ id: '' }).ok).toBe(false)
  })

  it('超长 id 拒绝', () => {
    expect(parseSessionId({ id: 'x'.repeat(65) }).ok).toBe(false)
  })
})

describe('parseJobId', () => {
  it('接受任务 id', () => {
    const result = parseJobId({ jobId: '3f9a1c2e' })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.value).toBe('3f9a1c2e')
  })

  it('空任务 id 拒绝', () => {
    expect(parseJobId({ jobId: '' }).ok).toBe(false)
  })
})
