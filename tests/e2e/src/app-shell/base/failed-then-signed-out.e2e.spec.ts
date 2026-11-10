// scenario: app-shell/base/failed-then-signed-out
import { holdTabEngines } from '../../support/engines'
import { appReady, expect, expectPathname, signOut, signUp, test } from '../../support/fixtures'

test.describe('Sign out in another tab after the data did not open', { tag: '@full' }, () => {
  test("A tab that could not open the account's data goes to the sign-in page once another tab signs the account out, and no longer offers to sign it out", async ({
    page,
  }) => {
    await test.step('1. On device A, sign up, open the link of [mail:sign-up] and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
      await signUp(page)
      await appReady(page)
    })

    const second =
      await test.step('2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/me')
        await appReady(tab)

        return tab
      })

    await test.step("3. Make the browser refuse the first tab's database engines, as when the network drops them, and reload the first tab", async () => {
      const engines = await holdTabEngines(page)

      engines.refuse()
      await page.reload({ waitUntil: 'commit' })
      // Expected: After step 3 the first tab's [app-shell.status] is in [state:failed] and it
      //   offers [app-shell.sign-out-here-button]
      await expect(page.getByTestId('app-shell.status')).toHaveAttribute('data-state', 'failed', {
        timeout: 15_000,
      })
      await expect(page.getByTestId('app-shell.sign-out-here-button')).toBeVisible()
    })

    await test.step('4. In the second tab, click [user.profile.sign-out-button] and wait for [/sign-in]', async () => {
      await signOut(second)
      // Expected: Within 5 seconds of step 4 the first tab is on [/sign-in] and shows
      //   [user.sign-in.form], and no [app-shell.sign-out-here-button]
      await expectPathname(page, '/sign-in', 5_000)
      await expect(page.getByTestId('user.sign-in.form')).toBeVisible()
      await expect(page.getByTestId('app-shell.sign-out-here-button')).toHaveCount(0)
    })
  })
})
