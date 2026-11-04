// scenario: user/flows/theme-across-tabs
import { appReady, expect, pageLoads, test } from '../../support/fixtures'

test.describe('Keep the theme of an account in every tab and on every device', {
  tag: '@full',
}, () => {
  test("A theme chosen in one tab shows in the account's other tab at once, and on the next device it signs in on", async ({
    page,
    secondDevice,
  }) => {
    const select = page.getByTestId('user.settings.theme-select')

    await test.step('1. On device A, open [/settings] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/settings')
      await appReady(page)
      // The select takes a choice once the account's settings are on the device.
      await expect(select).toBeEnabled()
    })

    const second =
      await test.step('2. On device A, open [/settings] in a second tab and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/settings')
        await appReady(tab)

        return tab
      })
    const secondSelect = second.getByTestId('user.settings.theme-select')
    const loadsOfFirst = pageLoads(page)
    const loadsOfSecond = pageLoads(second)

    await test.step('3. In the first tab of device A, choose [value:dark] in [user.settings.theme-select]', async () => {
      await select.click()
      await page
        .locator('[data-testid="user.settings.theme-select.option"][data-value="dark"]')
        .click()
      // Expected: After step 3 the first tab of device A shows [user.settings.theme-select] with
      //   [value:dark] at once
      // Expected: Within 5 seconds of step 3 the second tab of device A shows
      //   [user.settings.theme-select] with [value:dark], without a reload
      // Both start as the choice is made, so the 5-second timeout is one deadline counted from it.
      await Promise.all([
        expect(select).toHaveAttribute('data-value', 'dark'),
        expect(secondSelect).toHaveAttribute('data-value', 'dark', { timeout: 5_000 }),
      ])
      expect(loadsOfSecond()).toBe(0)
      // The store has ended once the select takes a choice again.
      await expect(select).toBeEnabled()
    })

    const deviceB =
      await test.step('4. On device B, sign in with the same account, wait for [/me] and open [/settings]', async () => {
        const b = await secondDevice.signIn()

        await b.getByTestId('app-shell.nav.settings-link').click()
        // Expected: After step 4 device B shows [user.settings.theme-select] with [value:dark],
        //   with no choice made on device B
        await expect(b.getByTestId('user.settings.theme-select')).toHaveAttribute(
          'data-value',
          'dark',
          { timeout: 10_000 },
        )

        return b
      })

    await test.step('5. On device B, choose [value:light] in [user.settings.theme-select]', async () => {
      const selectOfB = deviceB.getByTestId('user.settings.theme-select')

      await expect(selectOfB).toBeEnabled()
      await selectOfB.click()
      await deviceB
        .locator('[data-testid="user.settings.theme-select.option"][data-value="light"]')
        .click()
      // Expected: After step 5 both tabs of device A show [user.settings.theme-select] with
      //   [value:light], without a reload
      await Promise.all([
        expect(select).toHaveAttribute('data-value', 'light', { timeout: 10_000 }),
        expect(secondSelect).toHaveAttribute('data-value', 'light', { timeout: 10_000 }),
      ])
      expect(loadsOfFirst()).toBe(0)
      expect(loadsOfSecond()).toBe(0)
    })
  })
})
