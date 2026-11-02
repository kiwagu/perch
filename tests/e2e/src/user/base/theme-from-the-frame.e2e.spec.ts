// scenario: user/base/theme-from-the-frame
import { appReady, expect, signUp, test } from '../../support/fixtures'

test.describe('Choose the theme of this device from the frame, as a guest and signed in', {
  tag: '@full',
}, () => {
  test('A guest chooses the dark theme on the sign-in page, it stays after a reload, and the settings screen shows the same theme after sign-up', async ({
    page,
  }) => {
    const theme = page.getByTestId('app-shell.theme-select')

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      // Expected: After step 1 [app-shell.theme-select] shows [value:system]
      await expect(theme).toHaveAttribute('data-value', 'system')
    })

    await test.step('2. Choose [value:dark] in [app-shell.theme-select]', async () => {
      await expect(theme).toBeEnabled()
      await theme.click()
      await page.locator('[data-testid="app-shell.theme-select.option"][data-value="dark"]').click()
      // Expected: After step 2 [app-shell.theme-select] shows [value:dark]
      await expect(theme).toHaveAttribute('data-value', 'dark')
    })

    await test.step('3. Reload the page and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.reload()
      await appReady(page)
      // Expected: After step 3 [app-shell.theme-select] still shows [value:dark]
      await expect(theme).toHaveAttribute('data-value', 'dark')
    })

    await test.step('4. Sign up, open the link of [mail:sign-up], click [app-shell.nav.settings-link] and wait for [user.settings.heading]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
      // Expected: After step 4 [user.settings.theme-select] shows [value:dark], the theme chosen
      //   as a guest
      await expect(page.getByTestId('user.settings.theme-select')).toHaveAttribute(
        'data-value',
        'dark',
      )
    })

    await test.step('5. Choose [value:light] in [app-shell.theme-select]', async () => {
      await expect(theme).toBeEnabled()
      await theme.click()
      await page
        .locator('[data-testid="app-shell.theme-select.option"][data-value="light"]')
        .click()
      // Expected: After step 5 [user.settings.theme-select] shows [value:light] at once, the same
      //   theme as [app-shell.theme-select]
      await expect(page.getByTestId('user.settings.theme-select')).toHaveAttribute(
        'data-value',
        'light',
      )
      await expect(theme).toHaveAttribute('data-value', 'light')
    })
  })
})
