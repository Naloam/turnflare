import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

/**
 * 仪表盘关键用户流程。
 *
 * 数据来自 tools/sample-data.mjs 的固定示例，
 * 使用单个地址验证构建后的仪表盘与 API。
 */

test.describe('Turnflare 仪表盘', () => {
  test('switches every page to English and keeps the preference after reload', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('language-toggle').click()
    await expect(page.getByText('Total tokens', { exact: true })).toBeVisible()
    await expect(page.getByText('Estimated cost', { exact: true })).toBeVisible()
    await page.goto('/#/sessions')
    await expect(page.getByRole('button', { name: 'Scan sessions', exact: true })).toBeVisible()
    await expect(page.getByTestId('session-row').first()).toBeVisible()
    await page.getByTestId('session-row').first().click()
    await expect(page.getByRole('button', { name: '← Back to sessions' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '← Back to sessions' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.goto('/#/projects')
    await expect(page.getByText('Project cost comparison', { exact: true })).toBeVisible()
  })
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('总览页渲染 KPI 与图表', async ({ page }) => {
    // 等 KPI 卡片出现（数据已加载），加载骨架不应长期停留
    await expect(page.getByText('总 Token', { exact: true })).toBeVisible({ timeout: 15000 })

    // 四个 KPI 卡片。必须用 exact：页面上还有"按各模型总成本拆分……"这类
    // 说明文字，非精确匹配会一次命中多个元素，strict mode 直接报错。
    await expect(page.getByText('总成本', { exact: true })).toBeVisible()
    await expect(page.getByText('会话数', { exact: true })).toBeVisible()
    await expect(page.getByText('缓存命中率', { exact: true })).toBeVisible()

    // Recharts 用 SVG 渲染，确认图表容器有内容
    const svgCount = await page.locator('svg.recharts-surface').count()
    expect(svgCount).toBeGreaterThan(0)
  })

  test('无价目模型时显示醒目警告', async ({ page }) => {
    // 固定示例包含无价目模型，必须提示未覆盖成本。
    const warning = page.getByTestId('unpriced-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('无价目')
  })

  test('导航到会话列表并看到真实数据行', async ({ page }) => {
    await page
      .getByRole('navigation', { name: /主导航/ })
      .first()
      .getByText('会话')
      .click()
    await expect(page).toHaveURL(/#\/sessions/)

    // 表格至少有一行数据
    const rows = page.locator('table tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 15000 })
    expect(await rows.count()).toBeGreaterThan(0)
  })

  test('打开会话详情看到 turn 时间线', async ({ page }) => {
    await page.goto('/#/sessions')
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 })

    await page.locator('table tbody tr').first().click()
    await expect(page).toHaveURL(/#\/sessions\/[0-9a-f-]+/)

    // 详情页有内容：元信息或 turn 列表
    await expect(page.getByText(/turn|轮次|会话/).first()).toBeVisible({ timeout: 15000 })
  })

  test('项目页渲染项目对比', async ({ page }) => {
    await page.goto('/#/projects')
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible({ timeout: 15000 })
  })

  test('未知路由回退到总览', async ({ page }) => {
    await page.goto('/#/nonexistent-route')
    await expect(page).toHaveURL(/#\/overview/)
    await expect(page.getByText('总 Token', { exact: true })).toBeVisible({ timeout: 15000 })
  })

  test('主题切换在深浅色之间往返', async ({ page }) => {
    const html = page.locator('html')
    const initialDark = await html.evaluate((el) => el.classList.contains('dark'))

    await page
      .getByRole('button', { name: /主题|切换|深色|浅色/ })
      .first()
      .click()

    const afterDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(afterDark).not.toBe(initialDark)

    // 刷新后偏好应保留（localStorage）
    await page.reload()
    const persistedDark = await html.evaluate((el) => el.classList.contains('dark'))
    expect(persistedDark).toBe(afterDark)
  })

  test('API 健康检查返回正确包络', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.ok()).toBeTruthy()

    const payload = await response.json()
    expect(payload.success).toBe(true)
    expect(payload.error).toBeNull()
    expect(payload.data).toHaveProperty('name')
    expect(payload.data).toHaveProperty('sessionCount')
    expect(payload.data.sessionCount).toBeGreaterThan(0)
  })

  test('API 会话列表分页 meta 自洽', async ({ request }) => {
    const response = await request.get('/api/sessions?page=1&limit=5&sort=cost&order=desc')
    const payload = await response.json()

    expect(payload.success).toBe(true)
    expect(Array.isArray(payload.data)).toBe(true)
    expect(payload.meta.page).toBe(1)
    expect(payload.meta.limit).toBe(5)
    expect(payload.meta.total).toBeGreaterThanOrEqual(payload.data.length)

    // 按成本降序：每一项不大于前一项
    const costs = payload.data.map((item: { cost: { totalCost: number } }) => item.cost.totalCost)
    for (let i = 1; i < costs.length; i += 1) {
      expect(costs[i]).toBeLessThanOrEqual(costs[i - 1])
    }
  })

  test('API 拒绝非法排序参数', async ({ request }) => {
    const response = await request.get('/api/sessions?sort=drop-table')
    expect(response.status()).toBe(400)

    const payload = await response.json()
    expect(payload.success).toBe(false)
    expect(typeof payload.error).toBe('string')
    expect(payload.error.length).toBeGreaterThan(0)
  })

  test('API 报告导出四种格式', async ({ request }) => {
    const json = await request.get('/api/report?format=json')
    expect(json.ok()).toBeTruthy()

    const markdown = await request.get('/api/report?format=markdown')
    expect(markdown.ok()).toBeTruthy()
    expect(await markdown.text()).toContain('#')

    const csv = await request.get('/api/report?format=csv')
    expect(csv.ok()).toBeTruthy()
    // 必须带 BOM，否则 Excel 打开中文会乱码
    const csvBuffer = await csv.body()
    expect(csvBuffer[0]).toBe(0xef)
    expect(csvBuffer[1]).toBe(0xbb)
    expect(csvBuffer[2]).toBe(0xbf)

    const html = await request.get('/api/report?format=html')
    expect(html.ok()).toBeTruthy()
    expect(await html.text()).toContain('<svg')

    const bad = await request.get('/api/report?format=xml')
    expect(bad.status()).toBe(400)
  })

  test('demo data is isolated and write operations are disabled', async ({ request }) => {
    const health = await request.get('/api/health')
    const payload = await health.json()
    expect(payload.data.dataRoot).toContain('turnflare-sample-')
    expect(payload.data.sessionCount).toBe(9)
    const scan = await request.post('/api/scan', { data: { rootDir: '/private' } })
    expect(scan.status()).toBe(403)
  })
})

test.describe('会话详情的链条筛选', () => {
  /**
   * 取一场**有侧链 turn** 的会话 id；找不到返回 null。
   *
   * 不能图省事取 `/api/sessions?limit=1` 的第一场：列表按成本降序，而本地数据
   * 成本全是 $0，顺序不稳定，很可能拿到一场没有 subagent 的会话——而筛选器
   * 在侧链为 0 时按设计整条隐藏，测试就会莫名失败。
   */
  async function findSessionWithSidechain(request: APIRequestContext): Promise<string | null> {
    for (let page = 1; page <= 5; page += 1) {
      const response = await request.get(`/api/sessions?limit=50&page=${page}`)
      const payload = (await response.json()) as {
        data: readonly { sessionId: string }[]
      }
      for (const item of payload.data) {
        const detail = await request.get(`/api/sessions/${item.sessionId}`)
        const body = (await detail.json()) as {
          data: { turns: readonly { isSidechain: boolean }[] } | null
        }
        if (body.data?.turns.some((turn) => turn.isSidechain)) {
          return item.sessionId
        }
      }
      if (payload.data.length < 50) {
        break
      }
    }
    return null
  }

  test('侧链密集的会话显示筛选器，且默认视图以主对话为主', async ({ page, request }) => {
    // 合成夹具里也放了 1 条侧链，所以筛选器在两种数据模式下都该出现
    const sessionId = await findSessionWithSidechain(request)
    expect(sessionId).not.toBeNull()

    await page.goto(`/#/sessions/${sessionId}`)
    const filterAll = page.getByTestId('chain-filter-all')
    await expect(filterAll).toBeVisible({ timeout: 15000 })

    // 默认（全部）视图必须含主链 turn：500 条上限已改为主链优先，
    // 否则侧链会挤占全部名额，用户看不到自己的对话
    await expect(page.getByText(/Turn 时间线（\d+）/)).toBeVisible()
    const mainButton = page.getByTestId('chain-filter-main')
    const mainCount = Number((await mainButton.innerText()).replace(/\D/g, ''))
    expect(mainCount).toBeGreaterThan(0)
  })

  test('点「仅 subagent」后 URL 带 chain=side 且只剩侧链', async ({ page, request }) => {
    const sessionId = await findSessionWithSidechain(request)
    expect(sessionId).not.toBeNull()

    await page.goto(`/#/sessions/${sessionId}`)
    await expect(page.getByTestId('chain-filter-side')).toBeVisible({ timeout: 15000 })

    const sideButton = page.getByTestId('chain-filter-side')
    const sideCount = Number((await sideButton.innerText()).replace(/\D/g, ''))
    expect(sideCount).toBeGreaterThan(0)

    await sideButton.click()

    // URL 带上筛选值：刷新与分享都能保留视图
    await expect(page).toHaveURL(/chain=side/)
    // 时间线计数与按钮上的侧链数一致（受 500 条上限，故用 <=）
    await expect(sideButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('turn-item')).toHaveCount(sideCount)
  })

  test('URL 里的 chain=main 决定初始视图', async ({ page, request }) => {
    const sessionId = await findSessionWithSidechain(request)
    expect(sessionId).not.toBeNull()

    await page.goto(`/#/sessions/${sessionId}?chain=main`)

    // 直接以主对话口径渲染，主对话按钮处于选中态
    const mainButton = page.getByTestId('chain-filter-main')
    await expect(mainButton).toBeVisible({ timeout: 15000 })
    await expect(mainButton).toHaveAttribute('aria-pressed', 'true')
  })

  test('非法 chain 值回退全部', async ({ page, request }) => {
    const sessionId = await findSessionWithSidechain(request)
    expect(sessionId).not.toBeNull()

    await page.goto(`/#/sessions/${sessionId}?chain=bogus`)

    const allButton = page.getByTestId('chain-filter-all')
    await expect(allButton).toBeVisible({ timeout: 15000 })
    await expect(allButton).toHaveAttribute('aria-pressed', 'true')
  })
})
