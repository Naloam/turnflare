import { describe, expect, it } from 'vitest'
import { FakeRepository } from '../test-support/fake-repository.js'
import { makeAggregatedStats, makeModelStats, makeTimeBucket } from '../test-support/fixtures.js'
import { collectReportData, renderReport } from './index.js'
import type { ReportPayload } from './index.js'

const GENERATED_AT = '2026-10-19T12:00:00.000Z'

function makePayload(): ReportPayload {
  const repo = new FakeRepository({
    stats: makeAggregatedStats({
      byModel: [makeModelStats({ model: 'claude-opus-5-5' })],
      byDay: [makeTimeBucket({ bucket: '2026-10-19' })],
    }),
  })
  return collectReportData(repo, GENERATED_AT)
}

describe('collectReportData', () => {
  it('把仓储的五路数据收成一份载荷', () => {
    const payload = makePayload()

    expect(payload.generatedAt).toBe(GENERATED_AT)
    expect(payload.overview.sessionCount).toBe(3)
    expect(payload.models).toHaveLength(1)
    expect(payload.projects).toHaveLength(1)
    expect(payload.tools).toHaveLength(1)
    expect(payload.timeline).toHaveLength(1)
  })

  it('时间线固定按天取，供柱状图使用', () => {
    const payload = makePayload()

    expect(payload.timeline[0]?.bucket).toBe('2026-10-19')
  })
})

describe('renderReport', () => {
  it('json 返回 application/json', () => {
    const rendered = renderReport(makePayload(), 'json')

    expect(rendered.contentType).toBe('application/json; charset=utf-8')
    const envelope: unknown = JSON.parse(rendered.body)
    expect(envelope).toMatchObject({ success: true, error: null })
  })

  it('markdown 返回 text/markdown', () => {
    const rendered = renderReport(makePayload(), 'markdown')

    expect(rendered.contentType).toBe('text/markdown; charset=utf-8')
    expect(rendered.body).toContain('# Turnflare 用量报表')
  })

  it('csv 返回 text/csv 且带 BOM', () => {
    const rendered = renderReport(makePayload(), 'csv')

    expect(rendered.contentType).toBe('text/csv; charset=utf-8')
    expect(rendered.body.startsWith('﻿')).toBe(true)
  })

  it('html 返回 text/html', () => {
    const rendered = renderReport(makePayload(), 'html')

    expect(rendered.contentType).toBe('text/html; charset=utf-8')
    expect(rendered.body).toContain('<html lang="zh-CN">')
  })
})
