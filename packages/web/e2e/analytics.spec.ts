import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('filtered analytics downloads matching data and keeps budget preferences', async ({
  page,
}) => {
  await page.goto('/#/analytics')
  await expect(page.getByText('工具排行', { exact: true })).toBeVisible()
  await page.getByLabel('统计范围').selectOption('all')
  await page.getByLabel('开始日期（UTC）').fill('2026-10-19')
  await page.getByLabel('结束日期（含当天）').fill('2026-10-19')
  await expect(page.getByRole('button', { name: '导出当前筛选' })).toBeEnabled()
  await page.getByLabel('统计周期').selectOption('week')
  await page.getByLabel('所选范围预算（USD）').fill('1')
  await page.getByLabel('报告格式').selectOption('json')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出当前筛选' }).click(),
  ])
  const file = await download.path()
  expect(file).not.toBeNull()
  const report = JSON.parse(await readFile(file!, 'utf8'))
  expect(report.data.filters).toEqual({
    chain: 'all',
    since: '2026-10-19T00:00:00.000Z',
    until: '2026-10-20T00:00:00.000Z',
  })
  const response = await page.request.get(
    '/api/stats/analytics?chain=all&since=2026-10-19&until=2026-10-20',
  )
  const analytics = (await response.json()).data
  expect(report.data.overview.cost.totalCost).toBeCloseTo(analytics.cost.totalCost)
  await page.reload()
  await expect(page.getByLabel('所选范围预算（USD）')).toHaveValue('1')
  await page.getByTestId('language-toggle').click()
  await expect(page.getByText('Activity heatmap', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export selected data' })).toBeVisible()
})

test('session preview search handles literal symbols, clearing and encoded spaces', async ({
  page,
}) => {
  await page.goto('/#/sessions')
  await expect(page.getByTestId('session-row').first()).toBeVisible()
  await page.getByLabel('索引预览搜索').fill('% no match')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByTestId('session-row')).toHaveCount(0)
  await expect(page.getByLabel('索引预览搜索')).toHaveValue('% no match')
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(page.getByTestId('session-row').first()).toBeVisible()
  const model = await page.getByLabel('模型').locator('option').nth(1).getAttribute('value')
  if (model) await page.getByLabel('模型').selectOption(model)
})
