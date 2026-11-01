// scenario: app-shell/base/install-reminder
import type { Page } from '@playwright/test'

import { appReady, expect, test } from '../../support/fixtures'

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

const reminder = (page: Page) => page.getByTestId('app-shell.install-message')

/**
 * The browser offers to install the app, its window answering `outcome`: Chromium's own
 * `beforeinstallprompt` comes only when the browser judges the site installable, which a
 * headless browser never does, so the test makes the offer the page would hear.
 */
async function browserOffers(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((answer) => {
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: answer, platform: 'web' }),
    })

    window.dispatchEvent(offer)
  }, outcome)
}

test.describe('Be reminded to install the app until it is installed', { tag: '@full' }, () => {
  test("The reminder comes with the browser's offer, goes for three days when put off, comes back, and goes for good once the app is installed", async ({
    page,
  }) => {
    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      // Expected: After step 1 no [app-shell.install-message] shows
      await expect(reminder(page)).toHaveCount(0)
    })

    await test.step('2. The browser offers to install the app', async () => {
      await browserOffers(page)
      // Expected: After step 2 [app-shell.install-message] carries [code:install-available],
      //   with [app-shell.install-button] and [app-shell.install-later-button]
      await expect(reminder(page)).toHaveAttribute('data-code', 'install-available')
      await expect(page.getByTestId('app-shell.install-button')).toBeEnabled()
      await expect(page.getByTestId('app-shell.install-later-button')).toBeEnabled()
    })

    await test.step('3. Click [app-shell.install-later-button]', async () => {
      await page.getByTestId('app-shell.install-later-button').click()
      // Expected: After step 3 no [app-shell.install-message] shows
      await expect(reminder(page)).toHaveCount(0)
    })

    await test.step('4. Reload the page; the browser offers to install the app again', async () => {
      await page.reload()
      await appReady(page)
      await browserOffers(page)
      // Expected: After step 4 no [app-shell.install-message] shows: it is put off for three days
      await expect(reminder(page)).toHaveCount(0)
    })

    await test.step('5. Three days later, reload the page; the browser offers to install the app again', async () => {
      await page.clock.setFixedTime(new Date(Date.now() + THREE_DAYS + 60_000))
      await page.reload()
      await appReady(page)
      await browserOffers(page)
      // Expected: After step 5 [app-shell.install-message] carries [code:install-available] again
      await expect(reminder(page)).toHaveAttribute('data-code', 'install-available')
    })

    await test.step("6. Click [app-shell.install-button] and accept the browser's window", async () => {
      await page.getByTestId('app-shell.install-button').click()
      // Expected: After step 6 no [app-shell.install-message] shows
      await expect(reminder(page)).toHaveCount(0)
    })

    await test.step('7. Reload the page; the browser offers to install the app again', async () => {
      await page.reload()
      await appReady(page)
      await browserOffers(page)
      // Expected: After step 7 no [app-shell.install-message] shows: the app is installed on this
      //   device
      await expect(reminder(page)).toHaveCount(0)
    })
  })
})
