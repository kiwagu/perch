// scenario: app-shell/base/new-version
import type { Page } from '@playwright/test'

import { manifestSchema } from '@workspace/ui-contract'

import { appReady, expect, test } from '../../support/fixtures'

const MANIFEST = /\/ui-manifest\/manifest\.json$/

const updateMessage = (page: Page) => page.getByTestId('app-shell.update-message')

/**
 * The server starts serving another build: its manifest names the commit `commit` instead of
 * the one the page runs. The page's bundle stays the one it loaded, so the next read of the
 * manifest finds a newer build.
 */
async function serveNewer(page: Page, commit: string): Promise<void> {
  await page.route(MANIFEST, async (route) => {
    const served = await route.fetch()
    const manifest = manifestSchema.parse(await served.json())

    await route.fulfill({
      response: served,
      json: { ...manifest, product: { ...manifest.product, commit } },
    })
  })
}

/**
 * The newer build is what a load of the page brings from here on: the page loaded again runs
 * the build the manifest names, so the test serves the stand's own manifest again.
 */
async function loadsTheNewerBuild(page: Page): Promise<void> {
  await page.unroute(MANIFEST)
}

/**
 * The tab goes to the background, or comes back to the front. A headless browser keeps every
 * tab in the foreground, so the page hears what the browser tells it when a tab switches.
 */
async function showTab(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { value: next, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

test.describe('Load the newer version of the app the server serves', { tag: '@full' }, () => {
  test('A tab coming back to the front says a newer version is served, its button loads it, and a tab sent to the background with nothing unsaved loads it by itself', async ({
    page,
  }) => {
    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      const read = page.waitForResponse(MANIFEST)

      await page.goto('/sign-in')
      await appReady(page)
      await read
      // Expected: After step 1 no [app-shell.update-message] shows
      await expect(updateMessage(page)).toHaveCount(0)
    })

    await test.step('2. Serve a newer version of the app: the manifest at /ui-manifest/manifest.json names a version or a commit other than the one the tab runs', async () => {
      await serveNewer(page, 'f'.repeat(40))
    })

    await test.step('3. Switch to another tab, then back to this one', async () => {
      await showTab(page, 'hidden')
      await showTab(page, 'visible')
      // Expected: After step 3 [app-shell.update-message] carries [code:new-version], with
      //   [app-shell.update-button]
      await expect(updateMessage(page)).toHaveAttribute('data-code', 'new-version')
      await expect(page.getByTestId('app-shell.update-button')).toBeEnabled()
    })

    await test.step('4. Click [app-shell.update-button]', async () => {
      await loadsTheNewerBuild(page)

      const loaded = page.waitForEvent('load')
      const read = page.waitForResponse(MANIFEST)

      await page.getByTestId('app-shell.update-button').click()
      await loaded
      // Expected: After step 4 the page loads again on the version now served,
      //   [app-shell.status] reaches [state:ready] and no [app-shell.update-message] shows
      await appReady(page)
      await read
      await expect(updateMessage(page)).toHaveCount(0)
    })

    await test.step('5. Serve a newer version of the app again', async () => {
      await serveNewer(page, 'e'.repeat(40))
    })

    await test.step('6. Switch to another tab, then back to this one', async () => {
      await showTab(page, 'hidden')
      await showTab(page, 'visible')
      // Expected: After step 6 [app-shell.update-message] carries [code:new-version]
      await expect(updateMessage(page)).toHaveAttribute('data-code', 'new-version')
    })

    await test.step('7. Switch to another tab, then back to this one', async () => {
      await loadsTheNewerBuild(page)

      const loaded = page.waitForEvent('load')
      const read = page.waitForResponse(MANIFEST)

      await showTab(page, 'hidden')
      await loaded
      // A page loaded again starts in the foreground.
      // Expected: After step 7 the page has loaded again by itself while in the background:
      //   [app-shell.status] is in [state:ready] and no [app-shell.update-message] shows
      await appReady(page)
      await read
      await expect(updateMessage(page)).toHaveCount(0)
    })
  })
})
