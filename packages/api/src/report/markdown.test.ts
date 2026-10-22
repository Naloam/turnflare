import { describe, expect, it } from 'vitest'
import {
  makeAggregatedStats,
  makeModelStats,
  makeProjectStats,
  makeToolStats,
} from '../test-support/fixtures.js'
import type { ReportPayload } from './index.js'
import { renderMarkdownReport } from './markdown.js'

const GENERATED_AT = '2026-10-19T12:00:00.000Z'

function makePayload(
  overrides: Partial<Parameters<typeof makeAggregatedStats>[0]> = {},
): ReportPayload {
  return {
    generatedAt: GENERATED_AT,
    overview: makeAggregatedStats(overrides),
    models: [makeModelStats({ model: 'claude-opus-5-5', requestCount: 3201 })],
    projects: [makeProjectStats({ projectSlug: '-Users-che1sy-Projects-alpha', sessionCount: 12 })],
    tools: [makeToolStats({ toolName: 'Bash', callCount: 812, errorCount: 14 })],
    timeline: [],
  }
}

describe('renderMarkdownReport', () => {
  it('包含四个分节与标题', () => {
    const body = renderMarkdownReport(makePayload()).body

    expect(body).toContain('# Turnflare 用量报表')
    expect(body).toContain('## 总览')
    expect(body).toContain('## 模型分布')
    expect(body).toContain('## 项目分布')
    expect(body).toContain('## Top 工具')
  })

  it('总览表带成本与命中率', () => {
    const body = renderMarkdownReport(makePayload()).body

    expect(body).toContain('总成本')
    expect(body).toContain('缓存命中率')
    expect(body).toContain(GENERATED_AT)
  })

  it('模型与项目行带出真实取值', () => {
    const body = renderMarkdownReport(makePayload()).body

    expect(body).toContain('claude-opus-5-5')
    expect(body).toContain('3,201')
    expect(body).toContain('-Users-che1sy-Projects-alpha')
  })

  it('空数据时每个表都有占位说明', () => {
    const body = renderMarkdownReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats({
        sessionCount: 0,
        turnCount: 0,
        byModel: [],
        byProject: [],
        toolUsage: [],
      }),
      models: [],
      projects: [],
      tools: [],
      timeline: [],
    }).body

    // 总览表恒有指标行，另外三张表各一个占位
    expect(body.match(/暂无数据/g)).toHaveLength(3)
  })

  it('工具表最多列 10 行', () => {
    const tools = Array.from({ length: 15 }, (_, index) =>
      makeToolStats({ toolName: `Tool-${index}`, callCount: 100 - index }),
    )
    const body = renderMarkdownReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats({ toolUsage: tools }),
      models: [],
      projects: [],
      tools,
      timeline: [],
    }).body

    expect(body).toContain('Tool-0')
    expect(body).toContain('Tool-9')
    expect(body).not.toContain('Tool-10')
  })

  it('单元格里的竖线被转义，不会撑破表格', () => {
    const body = renderMarkdownReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats(),
      models: [makeModelStats({ model: 'evil|model' })],
      projects: [],
      tools: [],
      timeline: [],
    }).body

    expect(body).toContain('evil\\|model')
    // 转义后一行仍然是 6 列
    const row = body.split('\n').find((line) => line.includes('evil')) ?? ''
    expect(row.split('|').length - 1).toBeGreaterThan(6)
  })
})
