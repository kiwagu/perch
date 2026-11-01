// scenario: app-shell/base/open-offline
import { appReady, expect, signUp, test } from '../../support/fixtures'

// The one test that lets the app's service worker run: it opens the app offline.
test.use({ serviceWorkers: 'allow' })

test.describe('Open the app without a network', { tag: '@full' }, () => {
  test('A signed-in device that loaded the app once opens it again offline, with its own data', async ({
    page,
  }) => {
    const account =
      await test.step('1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
        const signedUp = await signUp(page)

        await appReady(page)

        return signedUp
      })

    await test.step('2. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      // The page loaded through the worker, which now holds the shell and the engines' WASM.
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 15_000,
      })
    })

    await test.step('3. Take the browser offline', async () => {
      await page.context().setOffline(true)
    })

    await test.step('4. Reload the page', async () => {
      await page.reload()
      // Expected: After step 4 [app-shell.status] reaches [state:ready] on [/me],
      //   [user.profile.heading] shows the name the account signed up with, and
      //   [app-shell.sync-message] carries [code:offline]
      await appReady(page)
      await expect(page).toHaveURL(/\/me$/)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name)
      await expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute(
        'data-code',
        'offline',
      )
    })

    await page.context().setOffline(false)
  })
})
