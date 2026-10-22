/**
 * @turnflare/api —— JSON 报表。
 *
 * 与 markdown / csv / html 的唯一区别：不需要任何排版，直接把包络序列化。
 * 保留它是因为 CLI 的 `--json` 与 Web 的"导出"都要消费同一份结构，
 * 少一层转换就少一处漂移。
 */

import type { ReportPayload, RenderedReport } from './index.js'

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/** 缩进两格：人可以直接读，diff 也好看 */
const JSON_INDENT = 2

export function renderJsonReport(payload: ReportPayload): RenderedReport {
  const envelope = {
    success: true,
    data: payload,
    error: null,
  }
  return {
    contentType: JSON_CONTENT_TYPE,
    body: `${JSON.stringify(envelope, null, JSON_INDENT)}\n`,
  }
}
