import { describe, expect, it } from 'vitest'
import { makeAggregatedStats, makeModelStats, makeToolStats } from '../test-support/fixtures.js'
import type { ReportPayload } from './index.js'
import { renderCsvReport } from './csv.js'

const GENERATED_AT = '2026-10-19T12:00:00.000Z'

/** Excel 靠 BOM 识别 UTF-8 */
const BOM = '﻿'

function makePayload(): ReportPayload {
  return {
    generatedAt: GENERATED_AT,
    overview: makeAggregatedStats(),
    models: [makeModelStats({ model: 'claude-opus-5-5', requestCount: 3201 })],
    projects: [],
    tools: [makeToolStats({ toolName: 'Bash', callCount: 812 })],
    timeline: [],
  }
}

describe('renderCsvReport 的公式注入防护', () => {
  /** 造一个模型名 / 工具名以公式前缀开头的载荷 */
  function makeHostilePayload(): ReportPayload {
    return {
      generatedAt: '2026-10-19T08:00:00.000Z',
      overview: makeAggregatedStats(),
      models: [makeModelStats({ model: '=HYPERLINK("http://evil","点我")', requestCount: 1 })],
      projects: [],
      tools: [makeToolStats({ toolName: "+cmd|'/c calc'!A1", callCount: 1 })],
      timeline: [],
    }
  }

  it.each(['=', '+', '-', '@'])('以 %s 开头的字段被前置单引号中和', (prefix) => {
    const payload: ReportPayload = {
      generatedAt: '2026-10-19T08:00:00.000Z',
      overview: makeAggregatedStats(),
      models: [makeModelStats({ model: `${prefix}SUM(1+1)`, requestCount: 1 })],
      projects: [],
      tools: [],
      timeline: [],
    }
    const body = renderCsvReport(payload).body
    // 中和单引号必须紧贴在前缀字符之前，且原字符仍在
    expect(body).toContain(`'${prefix}SUM(1+1)`)
  })

  it('敌意模型名不会以裸公式形态落库', () => {
    const body = renderCsvReport(makeHostilePayload()).body
    // 整行都被引号包住时，公式前缀前同样要有中和单引号
    expect(body).toContain("'=HYPERLINK")
    expect(body).toContain("'+cmd")
  })
})

describe('renderCsvReport', () => {
  it('以 BOM 开头', () => {
    expect(renderCsvReport(makePayload()).body.startsWith(BOM)).toBe(true)
  })

  it('BOM 之后第一个分节是总览', () => {
    const body = renderCsvReport(makePayload()).body

    // 标题行只有一个单元格，后面紧跟表头行
    expect(body.slice(BOM.length).startsWith('总览\r\n指标,数值')).toBe(true)
  })

  it('行尾是 CRLF', () => {
    const body = renderCsvReport(makePayload()).body

    expect(body).toContain('\r\n')
    expect(body.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true)
  })

  it('四个分节都出现', () => {
    const body = renderCsvReport(makePayload()).body

    expect(body).toContain('总览')
    expect(body).toContain('模型分布')
    expect(body).toContain('项目分布')
    expect(body).toContain('Top 工具')
  })

  it('数字保持原始精度，便于 Excel 继续计算', () => {
    const body = renderCsvReport(makePayload()).body

    expect(body).toContain('3201')
    expect(body).not.toContain('3,201')
  })

  it('含逗号与引号的字段被包起来并翻倍引号', () => {
    const body = renderCsvReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats(),
      models: [makeModelStats({ model: 'weird,"model"' })],
      projects: [],
      tools: [],
      timeline: [],
    }).body

    expect(body).toContain('"weird,""model"""')
  })

  it('空项目分节仍有表头与占位', () => {
    const body = renderCsvReport(makePayload()).body
    const lines = body.split('\r\n')

    expect(lines).toContain('项目,会话数,输入 Token,输出 Token,总成本（美元）')
    expect(lines).toContain('暂无数据')
  })

  it('工具表最多 10 行', () => {
    const tools = Array.from({ length: 15 }, (_, index) =>
      makeToolStats({ toolName: `Tool-${index}`, callCount: 100 - index }),
    )
    const body = renderCsvReport({
      generatedAt: GENERATED_AT,
      overview: makeAggregatedStats({ toolUsage: tools }),
      models: [],
      projects: [],
      tools,
      timeline: [],
    }).body

    expect(body).toContain('Tool-9')
    expect(body).not.toContain('Tool-10')
  })
})
