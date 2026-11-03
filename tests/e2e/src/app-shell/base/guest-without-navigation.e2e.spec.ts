// scenario: app-shell/base/guest-without-navigation
import { generate } from '../../support/data'
import { appReady, expect, expectPathname, signUp, test } from '../../support/fixtures'

test.describe('See no navigation as a guest', { tag: '@smoke' }, () => {
  test('A guest sees no navigation on the sign-in page; a signed-in account sees it, and it goes again at sign-out', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }
    const nav = page.getByTestId('app-shell.nav')

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
      // Expected: After step 1 no [app-shell.nav] shows, while [app-shell.theme-select] and
      //   [app-shell.locale-select] do
      await expect(page.getByTestId('app-shell.theme-select')).toBeVisible()
      await expect(page.getByTestId('app-shell.locale-select')).toBeVisible()
      await expect(nav).toHaveCount(0)
    })

    await test.step('2. Sign up with the email, the password and the name, and open the link of [mail:sign-up]', async () => {
      await signUp(page, data)
      // Expected: After step 2 the URL is [/me] and [app-shell.nav] shows
      //   [app-shell.nav.profile-link], [app-shell.nav.organisation-link],
      //   [app-shell.nav.devices-link] and [app-shell.nav.settings-link]
      await expectPathname(page, '/me')
      await expect(nav).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.profile-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.organisation-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.devices-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.settings-link')).toBeVisible()
    })

    await test.step('3. Click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      // Expected: After step 3 the URL is [/sign-in] and no [app-shell.nav] shows
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
      // The sign-in page has rendered, so no navigation is a frame without one.
      await expect(page.getByTestId('user.sign-in.form')).toBeVisible()
      await expect(nav).toHaveCount(0)
    })
  })
})
