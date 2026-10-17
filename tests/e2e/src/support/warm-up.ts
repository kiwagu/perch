import { chromium } from '@playwright/test'

import { BASE_URL } from '../../playwright.config'

/**
 * Opens the app once before the run. A fresh Vite dev server optimises
 * dependencies on the first page load and may reload that page; that happens
 * here rather than in the middle of a test.
 */
export default async function warmUp(): Promise<void> {
  const browser = await chromium.launch()

  try {
    // The front's certificate is a local one, as in the tests' own contexts.
    const page = await browser.newPage({ ignoreHTTPSErrors: true })

    await page.goto(`${BASE_URL}/sign-in`)
    await page.getByTestId('app-shell.ready').waitFor({ state: 'attached', timeout: 120_000 })
  } finally {
    await browser.close()
  }
}
