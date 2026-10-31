// scenario: app-shell/base/open-before-data
import { holdEngines } from '../../support/engines'
import { appReady, expect, signUp, test } from '../../support/fixtures'

test.describe('See the frame and the screen before the data opens', { tag: '@smoke' }, () => {
  test('A signed-in device shows its frame and the open screen while its data opens, then the data', async ({
    page,
  }) => {
    const account =
      await test.step('1. Sign up and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
        const signedUp = await signUp(page)

        await appReady(page)

        return signedUp
      })

    const engines =
      await test.step("2. Hold back the page's database engines, so that the account's data cannot open yet", () =>
        holdEngines(page.context()))

    await test.step('3. Reload the page', async () => {
      await page.reload({ waitUntil: 'commit' })
      // Expected: After step 3 [app-shell.status] reaches [state:opening-data] on [/me]:
      //   [app-shell.nav] shows [app-shell.nav.profile-link], [app-shell.nav.organisation-link],
      //   [app-shell.nav.devices-link] and [app-shell.nav.settings-link], and
      //   [user.profile.status] is in [state:loading]
      await expect(page.getByTestId('app-shell.status')).toHaveAttribute(
        'data-state',
        'opening-data',
      )
      await expect(page).toHaveURL(/\/me$/)

      const nav = page.getByTestId('app-shell.nav')

      await expect(nav.getByTestId('app-shell.nav.profile-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.organisation-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.devices-link')).toBeVisible()
      await expect(nav.getByTestId('app-shell.nav.settings-link')).toBeVisible()
      await expect(page.getByTestId('user.profile.status')).toHaveAttribute('data-state', 'loading')
    })

    await test.step('4. Let the database engines load', async () => {
      engines.release()
      // Expected: After step 4 [app-shell.status] reaches [state:ready] and
      //   [user.profile.heading] shows the name the account signed up with
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(account.name)
    })
  })
})
