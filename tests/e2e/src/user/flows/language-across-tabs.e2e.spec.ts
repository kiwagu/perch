// scenario: user/flows/language-across-tabs
import { appReady, expect, pageLoads, test } from '../../support/fixtures'

test.describe('Keep the language of an account in every tab', { tag: '@full' }, () => {
  test("A language chosen in one tab is spoken in the account's other tab at once", async ({
    page,
    signedIn: _signedIn,
  }) => {
    const select = page.getByTestId('user.settings.locale-select')

    await test.step('1. In a first tab, open [/settings] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/settings')
      await appReady(page)
      // The select takes a choice once the account's settings are on the device.
      await expect(select).toBeEnabled()
    })

    const second =
      await test.step('2. In a second tab, open [/settings] and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/settings')
        await appReady(tab)
        await expect(tab.getByTestId('user.settings.locale-select')).toHaveAttribute(
          'data-value',
          'en',
        )

        return tab
      })
    const loads = pageLoads(second)

    await test.step('3. In the first tab, choose [value:es] in [user.settings.locale-select]', async () => {
      await select.click()
      await page
        .locator('[data-testid="user.settings.locale-select.option"][data-value="es"]')
        .click()
      // Expected: After step 3 the first tab shows [user.settings.locale-select] with [value:es]
      //   at once
      // Expected: Within 5 seconds of step 3 the second tab shows [user.settings.locale-select]
      //   with [value:es], without a reload
      // Both start as the choice is made, so the 5-second timeout is one deadline counted from it.
      await Promise.all([
        expect(select).toHaveAttribute('data-value', 'es'),
        expect(second.getByTestId('user.settings.locale-select')).toHaveAttribute(
          'data-value',
          'es',
          { timeout: 5_000 },
        ),
      ])
      expect(loads()).toBe(0)
    })
  })
})
