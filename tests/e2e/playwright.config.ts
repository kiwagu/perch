import { defineConfig, devices } from '@playwright/test'

import { z } from '@workspace/zod'

// The `caddy-e2e` front of this checkout's mcproc manifest: the web app's production build
// and, under /backend/, the `gateway-e2e` gateway on one origin. `bun run test:e2e` runs the
// launcher through `mcproc exec`, which sets E2E_BASE_URL from the manifest's vars
// (https://localhost:5493 in the main checkout, shifted by 100 per worktree slot); the
// launcher builds the app and starts the stand before the run.
export const BASE_URL = z
  .url({
    protocol: /^https$/,
    error:
      'E2E_BASE_URL must be the https:// address of the caddy-e2e front; run the suite with bun run test:e2e',
  })
  .parse(process.env['E2E_BASE_URL'])

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.spec.ts',
  // Measured 2026-10-16 on the dev host, 4 tests (2 specs x 2 projects): 1 worker
  // 28.3 s, 2 workers 18.4 s, both stable over repeated runs; every test signs up a
  // fresh account in a fresh browser context, so specs share no state. CI keeps one
  // worker so its log reads in spec order.
  workers: process.env['CI'] ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Screenshot baselines are not committed (images stay out of the repository): the
  // first run on a machine writes them, later runs compare against them.
  updateSnapshots: 'missing',
  use: {
    baseURL: BASE_URL,
    // The front's certificate is a local one (mkcert's, or self-signed without mkcert).
    ignoreHTTPSErrors: true,
    // The production build registers the app's service worker, which caches what it serves: every
    // test runs without it, so requests and page loads stay the network's, but the one that opens
    // the app offline (`app-shell/base/open-offline`).
    serviceWorkers: 'block',
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
