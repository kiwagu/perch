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
  // Every test signs up a fresh account in a fresh browser context, so specs share no state, and
  // each worker's browsers claim a client address of their own at the front
  // (`src/support/client-address.ts`), so the gateway's per-address limits do not bind the number
  // of workers either. Two, measured 2026-11-06 on the dev host (14 cores, 20 threads) over the
  // 107 tests: 237 s; three took 211 s, only 11% less, for 3.2 GB of memory at the peak instead
  // of 2.2 GB, and each test ran about 40% longer: on a host other runs share, that once took
  // `signed-out-before-data` past the default 30-second budget, with no tab found waiting on
  // another. The reporter prints each spec file's tests together.
  workers: 2,
  reporter: [['./scripts/spec-reporter.ts'], ['html', { open: 'never' }]],
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
  // Mobile first: every test runs on a phone, and the `@smoke` ones on a desktop too.
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      grep: /@smoke/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
