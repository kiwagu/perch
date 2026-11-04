// scenario: app-shell/flows/theme-across-guest-tabs
import { appReady, expect, pageLoads, test } from '../../support/fixtures'

test.describe("Follow a guest's theme in every tab of the browser", { tag: '@full' }, () => {
  test("A theme a guest chooses in one tab shows in the browser's other tab at once", async ({
    page,
  }) => {
    const select = page.getByTestId('app-shell.theme-select')

    await test.step('1. In a first tab, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    const second =
      await test.step('2. In a second tab, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        await tab.goto('/sign-in')
        await appReady(tab)
        // Expected: After step 2 [app-shell.theme-select] shows [value:system] in both tabs
        await expect(select).toHaveAttribute('data-value', 'system')
        await expect(tab.getByTestId('app-shell.theme-select')).toHaveAttribute(
          'data-value',
          'system',
        )

        return tab
      })
    const loads = pageLoads(second)

    await test.step('3. In the first tab, choose [value:dark] in [app-shell.theme-select]', async () => {
      await expect(select).toBeEnabled()
      await select.click()
      await page.locator('[data-testid="app-shell.theme-select.option"][data-value="dark"]').click()
      // Expected: After step 3 the first tab's [app-shell.theme-select] shows [value:dark] at once
      // Expected: Within 5 seconds of step 3 the second tab's [app-shell.theme-select] shows
      //   [value:dark], without a reload
      // Both start as the choice is made, so the 5-second timeout is one deadline counted from it.
      await Promise.all([
        expect(select).toHaveAttribute('data-value', 'dark'),
        expect(second.getByTestId('app-shell.theme-select')).toHaveAttribute('data-value', 'dark', {
          timeout: 5_000,
        }),
      ])
      expect(loads()).toBe(0)
    })
  })
})
