import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReportExport } from './ReportExport'

afterEach(() => {
  Object.defineProperty(window, 'turnflareDesktop', { value: undefined, configurable: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses the native save dialog with the selected format and exact filters, and handles cancel/failure', async () => {
  const saveReport = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('permission'))
  Object.defineProperty(window, 'turnflareDesktop', { configurable: true, value: { saveReport } })
  render(<ReportExport filters={{ chain: 'side', project: 'private' }} />)
  fireEvent.change(screen.getByLabelText('报告格式'), { target: { value: 'csv' } })
  fireEvent.click(screen.getByRole('button', { name: '导出当前筛选' }))
  expect(await screen.findByText('报告已保存')).toBeInTheDocument()
  expect(saveReport).toHaveBeenCalledWith('csv', { chain: 'side', project: 'private' })
  fireEvent.click(screen.getByRole('button', { name: '导出当前筛选' }))
  expect(await screen.findByText('已取消保存')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '导出当前筛选' }))
  expect(await screen.findByText('导出失败，请重试')).toBeInTheDocument()
})

it('downloads a browser blob rather than navigating away from the app', async () => {
  const create = vi.fn().mockReturnValue('blob:report')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['report']) })
  vi.stubGlobal('fetch', fetcher)
  render(<ReportExport filters={{ chain: 'all', since: '2026-10-19T00:00:00.000Z' }} />)
  fireEvent.click(screen.getByRole('button', { name: '导出当前筛选' }))
  expect(await screen.findByText('报告已下载')).toBeInTheDocument()
  expect(click).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledWith(
    '/api/report?format=html&chain=all&since=2026-10-19T00%3A00%3A00.000Z',
  )
})
