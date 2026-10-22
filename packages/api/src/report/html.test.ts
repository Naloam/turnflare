import { describe, expect, it } from 'vitest'
import {
  makeAggregatedStats,
  makeModelStats,
  makeProjectStats,
  makeTimeBucket,
  makeToolStats,
} from '../test-support/fixtures.js'
import type { ReportPayload } from './index.js'
import { escapeHtml, renderHtmlReport } from './html.js'

const GENERATED_AT = '2026-10-19T12:00:00.000Z'

function makePayload(): ReportPayload {
  return {
    generatedAt: GENERATED_AT,
    overview: makeAggregatedStats({ cacheHitRate: 0.948 }),
    models: [makeModelStats({ model: 'claude-opus-5-5' })],
    projects: [makeProjectStats({ projectSlug: '-Users-che1sy-Projects-alpha' })],
    tools: [makeToolStats({ toolName: 'Bash' })],
    timeline: [
      makeTimeBucket({ bucket: '2026-10-17' }),
      makeTimeBucket({ bucket: '2026-10-18' }),
      makeTimeBucket({ bucket: '2026-10-19' }),
    ],
  }
}

describe('escapeHtml', () => {
  it('转义五个危险字符', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('& 优先替换，不会二次转义', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('普通文本原样返回', () => {
    expect(escapeHtml('claude-opus-5-5')).toBe('claude-opus-5-5')
  })
})

describe('renderHtmlReport', () => {
  it('是自包含单文件：无外部请求', () => {
    const body = renderHtmlReport(makePayload()).body

    expect(body).toContain('<style>')
    expect(body).not.toContain('http://')
    expect(body).not.toContain('https://')
    expect(body).not.toContain('<script')
    expect(body).not.toMatch(/<link[^>]+rel="stylesheet"/)
  })

  it('中文标题与 meta', () => {
    const body = renderHtmlReport(makePayload()).body

    expect(body).toContain('lang="zh-CN"')
    expect(body).toContain('Turnflare 用量报表')
    expect(body).toContain(GENERATED_AT)
  })

  it('含手写 SVG 柱状图与每日成本', () => {
    const body = renderHtmlReport(makePayload()).body

    expect(body).toContain('<svg')
    expect(body).toContain('每日成本')
    // 三天的数据应画出三根柱子
    expect(body.match(/<rect/g)).toHaveLength(3)
    expect(body).toContain('10-17')
    expect(body).toContain('10-19')
  })

  it('KPI 卡片带缓存命中率', () => {
    const body = renderHtmlReport(makePayload()).body

    expect(body).toContain('缓存命中率')
    expect(body).toContain('94.8%')
  })

  it('来自数据的字符串全部转义', () => {
    const body = renderHtmlReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats(),
      models: [makeModelStats({ model: '<script>alert(1)</script>' })],
      projects: [makeProjectStats({ projectSlug: '"><img src=x onerror=alert(1)>' })],
      tools: [makeToolStats({ toolName: '<b>Bash</b>' })],
      timeline: [],
    }).body

    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(body).not.toContain('<img src=x')
    expect(body).toContain('&lt;b&gt;Bash&lt;/b&gt;')
  })

  it('空时间线给出占位说明而不是空白图', () => {
    const body = renderHtmlReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats(),
      models: [],
      projects: [],
      tools: [],
      timeline: [],
    }).body

    expect(body).not.toContain('<svg')
    expect(body).toContain('暂无数据')
  })

  it('空表格也有表头与占位行', () => {
    const body = renderHtmlReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats(),
      models: [],
      projects: [],
      tools: [],
      timeline: [],
    }).body

    expect(body).toContain('<th>模型</th>')
    expect(body).toContain('colspan="5"')
  })
})
