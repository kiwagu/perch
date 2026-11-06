// scenario: app-shell/base/signed-out-before-data
import { generate } from '../../support/data'
import { holdTabEngines } from '../../support/engines'
import { appReady, expect, expectPathname, signOut, signUp, test } from '../../support/fixtures'

test.describe('Sign out in another tab while the data opens', { tag: '@full' }, () => {
  test('A tab whose account another tab signs out while its data opens goes to the sign-in page at once, then follows the account signed in next', async ({
    page,
  }) => {
    // Two sign-ups, each opening its account's data, and a sign-out: with other runs on the
    // host's CPU it can take more than 30 seconds, every step slower and none stuck. To be
    // measured again once full e2e runs stop sharing the host's CPU.
    test.slow()

    const other = {
      ...generate.account(),
      email: generate.otherEmail(),
      password: generate.otherPassword(),
      name: generate.otherName(),
    }

    await test.step('1. On device A, sign up, open the link of [mail:sign-up], click [app-shell.nav.devices-link] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await signUp(page)
      await page.getByTestId('app-shell.nav.devices-link').click()
      await expectPathname(page, '/devices')
      await appReady(page)
    })

    const second =
      await test.step('2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/me')
        await appReady(tab)

        return tab
      })

    const engines =
      await test.step("3. Hold back the first tab's database engines, so that its account's data cannot open yet, and reload the first tab", async () => {
        const held = await holdTabEngines(page)

        await page.reload({ waitUntil: 'commit' })
        // Expected: After step 3 the first tab's [app-shell.status] reaches [state:opening-data]
        //   on [/devices], and its [device.list] holds one [device.list.session-item], in
        //   [state:current]
        await expect(page.getByTestId('app-shell.status')).toHaveAttribute(
          'data-state',
          'opening-data',
        )
        await expect(page).toHaveURL(/\/devices$/)
        await expect(
          page.getByTestId('device.list').getByTestId('device.list.session-item'),
        ).toHaveCount(1)
        await expect(
          page.locator('[data-testid="device.list.session-item"][data-state="current"]'),
        ).toHaveCount(1)

        return held
      })

    await test.step('4. In the second tab, click [user.profile.sign-out-button] and wait for [/sign-in]', async () => {
      await signOut(second)
      // Expected: Within 5 seconds of step 4 the first tab is on [/sign-in] and shows
      //   [user.sign-in.form], its database engines still held back
      await expectPathname(page, '/sign-in', 5_000)
      await expect(page.getByTestId('user.sign-in.form')).toBeVisible()
    })

    await test.step('5. In the second tab, sign up with the other email, the other password and the other name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(second, other)
    })

    await test.step("6. Let the first tab's database engines load", async () => {
      engines.release()
      // Expected: After step 6 the first tab is on [/me] and its [user.profile.heading] shows the
      //   other name: it follows the account signed in next once it can open that account's data
      await expectPathname(page, '/me')
      await expect(page.getByTestId('user.profile.heading')).toHaveText(other.name, {
        timeout: 15_000,
      })
    })
  })
})
