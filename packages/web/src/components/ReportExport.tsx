import { useState } from 'react'
import type { ReportFormat, UsageQuery } from '../types/api'
import { desktopBridge } from '../lib/desktop'
import { usageSearch } from '../lib/analytics'
import { t, useLocale } from '../lib/locale'
import { CONTROL_CLASS } from './UsageFilters'

export function ReportExport({
  filters,
  disabled = false,
}: {
  readonly filters: UsageQuery
  readonly disabled?: boolean
}) {
  useLocale()
  const [format, setFormat] = useState<ReportFormat>('html')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function save() {
    setBusy(true)
    setNote('')
    try {
      const desktop = desktopBridge()
      if (desktop !== undefined) {
        setNote((await desktop.saveReport(format, filters)) ? '报告已保存' : '已取消保存')
      } else {
        const response = await fetch(`/api/report?format=${format}&${usageSearch(filters)}`)
        if (!response.ok) throw new Error('export failed')
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `turnflare-report.${format === 'markdown' ? 'md' : format}`
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNote('报告已下载')
      }
    } catch {
      setNote('导出失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="report-format">
        {t('报告格式')}
      </label>
      <select
        id="report-format"
        className={CONTROL_CLASS}
        value={format}
        onChange={(e) => {
          const value = e.target.value
          if (value === 'html' || value === 'json' || value === 'csv' || value === 'markdown')
            {setFormat(value)}
        }}
      >
        <option value="html">HTML</option>
        <option value="csv">CSV</option>
        <option value="markdown">Markdown</option>
        <option value="json">JSON</option>
      </select>
      <button
        className={CONTROL_CLASS}
        disabled={busy || disabled}
        onClick={() => {
          void save()
        }}
      >
        {t(busy ? '正在导出…' : '导出当前筛选')}
      </button>
      {note ? (
        <span role="status" className="text-xs text-ink-2">
          {t(note)}
        </span>
      ) : null}
    </div>
  )
}
