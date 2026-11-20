// scenario: app-shell/base/start-failed
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { refuseStartCode } from '../../support/start-code'

test.describe('Open the app when the code of its start does not load', { tag: '@smoke' }, () => {
  test('A start whose code does not load says the app could not start and offers no sign-out, although an account is saved', async ({
    page,
  }) => {
    await test.step('1. Sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
      await signUp(page)
      await appReady(page)
    })

    await test.step("2. Make the browser refuse the page the code of the app's start, which loads after the first frame, as when the network drops it", () =>
      refuseStartCode(page.context()))

    await test.step('3. Reload the page', async () => {
      await page.reload({ waitUntil: 'commit' })
    })

    // Expected:
    // - After step 3 [app-shell.status] is in [state:start-failed]: the page says the app could
    //   not start on this device, and to reload the page to try again
    const status = page.getByTestId('app-shell.status')

    await expect(status).toHaveAttribute('data-state', 'start-failed')
    await expect(status).toBeVisible()
    // - The page shows [app-shell.theme-select] and [app-shell.locale-select], and no
    //   [app-shell.sign-out-here-button] and no [app-shell.nav]
    await expect(page.getByTestId('app-shell.theme-select')).toBeVisible()
    await expect(page.getByTestId('app-shell.locale-select')).toBeVisible()
    await expect(page.getByTestId('app-shell.sign-out-here-button')).toHaveCount(0)
    await expect(page.getByTestId('app-shell.nav')).toHaveCount(0)
  })
})
