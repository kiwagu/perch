// scenario: app-shell/base/install-by-steps
import { appReady, expect, test } from '../../support/fixtures'

/** Safari on an iPhone, where only the user's own steps install the app. */
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

// Chromium under Safari's user agent: the page tells Safari on an iPhone apart by its user agent
// alone, so this proves the steps the page shows there, not Safari's own Add to Home Screen.
test.use({ userAgent: IPHONE_SAFARI })

test.describe('Be shown the steps that install the app where the browser cannot', {
  tag: '@full',
}, () => {
  test('Safari on an iPhone shows the steps that install the app, which the user can put off', async ({
    page,
  }) => {
    const reminder = page.getByTestId('app-shell.install-message')

    await test.step('1. Open [/sign-in] in Safari on an iPhone and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      // Expected: After step 1 [app-shell.install-message] carries [code:install-by-steps], with
      //   [app-shell.install-later-button] and no [app-shell.install-button]
      await expect(reminder).toHaveAttribute('data-code', 'install-by-steps')
      await expect(page.getByTestId('app-shell.install-later-button')).toBeEnabled()
      await expect(page.getByTestId('app-shell.install-button')).toHaveCount(0)
    })

    await test.step('2. Click [app-shell.install-later-button]', async () => {
      await page.getByTestId('app-shell.install-later-button').click()
      // Expected: After step 2 no [app-shell.install-message] shows
      await expect(reminder).toHaveCount(0)
    })

    await test.step('3. Reload the page', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 3 no [app-shell.install-message] shows: it is put off for three days
      await expect(reminder).toHaveCount(0)
    })
  })
})
