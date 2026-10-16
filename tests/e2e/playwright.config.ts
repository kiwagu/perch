import { defineConfig, devices } from '@playwright/test'

// The `web-e2e` app of the mcproc manifest; the launcher starts it before the run.
export const BASE_URL = 'http://127.0.0.1:5190'

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.spec.ts',
  globalSetup: './src/support/warm-up.ts',
  // Measured 2026-10-16 on the dev host, 4 tests (2 specs x 2 projects): 1 worker
  // 28.3 s, 2 workers 18.4 s, both stable over repeated runs; every test signs up a
  // fresh account in a fresh browser context, so specs share no state. CI keeps one
  // worker so its log reads in spec order.
  workers: process.env['CI'] ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
  },
  // Mobile first: every spec runs on a phone, then on a desktop.
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
