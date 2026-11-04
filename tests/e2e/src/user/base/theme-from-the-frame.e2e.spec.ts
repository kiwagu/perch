// scenario: user/base/theme-from-the-frame
import { appReady, expect, expectPathname, signOut, signUp, test } from '../../support/fixtures'

test.describe('Choose the theme of this device from the frame as a guest, and the account starts with it', {
  tag: '@full',
}, () => {
  test('A guest chooses the dark theme on the sign-in page, it stays after a reload, the account created on this device starts with it, and after a sign-out the frame shows the theme the account showed last', async ({
    page,
  }) => {
    const theme = page.getByTestId('app-shell.theme-select')
    const settingsTheme = page.getByTestId('user.settings.theme-select')

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
      // Expected: After step 4 no [app-shell.theme-select] shows, and [user.settings.theme-select]
      //   shows [value:dark], the theme chosen as a guest
      await expect(theme).toHaveCount(0)
      await expect(settingsTheme).toHaveAttribute('data-value', 'dark')
    })

    await test.step('5. Choose [value:light] in [user.settings.theme-select]', async () => {
      // The select takes a choice once the account's settings are on the device.
      await expect(settingsTheme).toBeEnabled()
      await settingsTheme.click()
      await page
        .locator('[data-testid="user.settings.theme-select.option"][data-value="light"]')
        .click()
      // Expected: After step 5 [user.settings.theme-select] shows [value:light]
      await expect(settingsTheme).toHaveAttribute('data-value', 'light')
      // The store has ended once the select takes a choice again.
      await expect(settingsTheme).toBeEnabled()
    })

    await test.step('6. Click [app-shell.nav.profile-link] and click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await signOut(page)
      // Expected: After step 6 the URL is [/sign-in] and [app-shell.theme-select] shows
      //   [value:light], the theme this device showed last
      await expectPathname(page, '/sign-in')
      await appReady(page)
      await expect(theme).toHaveAttribute('data-value', 'light')
    })
  })
})
