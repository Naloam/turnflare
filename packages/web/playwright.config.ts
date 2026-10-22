import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.TURNFLARE_E2E_PORT ?? 18787)
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: origin,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Exercise the production build, served by the API with synthetic data only.
  // Never reuse a developer's server or read their Claude history.
  webServer: {
    command: 'node ../../tools/demo-server.mjs',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(port), NODE_ENV: 'test' },
  },
})
