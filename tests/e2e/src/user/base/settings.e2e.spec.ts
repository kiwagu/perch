// scenario: user/base/settings
import { appReady, expect, signUp, test } from '../../support/fixtures'

test.describe('Choose the theme of this device and the language of the account', {
  tag: '@smoke',
}, () => {
  test('A signed-in user chooses the dark theme and Spanish, and both stay after a reload', async ({
    page,
  }) => {
    const theme = page.getByTestId('user.settings.theme-select')
    const language = page.getByTestId('user.settings.locale-select')

    await test.step('1. Sign up, click [app-shell.nav.settings-link] and wait for [user.settings.heading]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
      // Expected: After step 1 the URL is [/settings], [user.settings.theme-select] shows
      //   [value:system] and [user.settings.locale-select] shows [value:en]
      await expect(page).toHaveURL(/\/settings$/)
      await expect(theme).toHaveAttribute('data-value', 'system')
      await expect(language).toHaveAttribute('data-value', 'en')
    })

    await test.step('2. Choose [value:dark] in [user.settings.theme-select]', async () => {
      await expect(theme).toBeEnabled()
      await theme.click()
      await page
        .locator('[data-testid="user.settings.theme-select.option"][data-value="dark"]')
        .click()
      // Expected: After step 2 [user.settings.theme-select] shows [value:dark]
      await expect(theme).toHaveAttribute('data-value', 'dark')
    })

    await test.step('3. Choose [value:es] in [user.settings.locale-select]', async () => {
      // The select takes a choice once the account's settings are on the device.
      await expect(language).toBeEnabled()
      await language.click()
      await page
        .locator('[data-testid="user.settings.locale-select.option"][data-value="es"]')
        .click()
      // Expected: After step 3 [user.settings.locale-select] shows [value:es] at once
      await expect(language).toHaveAttribute('data-value', 'es')
      // The store has ended once the select takes a choice again: the reload below cannot race it.
      await expect(language).toBeEnabled()
    })

    await test.step('4. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 4 [user.settings.theme-select] still shows [value:dark] and
      //   [user.settings.locale-select] still shows [value:es]
      await expect(theme).toHaveAttribute('data-value', 'dark')
      await expect(language).toHaveAttribute('data-value', 'es', { timeout: 10_000 })
    })
  })
})
