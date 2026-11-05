// scenario: user/flows/language-across-devices
import { appReady, expect, pageLoads, test } from '../../support/fixtures'

test.describe('Keep the language of an account on every device', { tag: '@full' }, () => {
  test('A language chosen on one device is the language of the account on the next device it signs in on', async ({
    page,
    secondDevice,
  }) => {
    const select = page.getByTestId('user.settings.locale-select')

    await test.step('1. On device A, open [/settings] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/settings')
      await appReady(page)
      // The select takes a choice once the account's settings are on the device.
      await expect(select).toBeEnabled()
    })

    await test.step('2. On device A, choose [value:es] in [user.settings.locale-select]', async () => {
      await select.click()
      await page
        .locator('[data-testid="user.settings.locale-select.option"][data-value="es"]')
        .click()
      // Expected: After step 2 device A shows [user.settings.locale-select] with [value:es] at once
      await expect(select).toHaveAttribute('data-value', 'es')
    })

    const deviceB =
      await test.step('3. On device B, sign in with the same account, wait for [/me] and open [/settings]', async () => {
        const b = await secondDevice.signIn()

        await b.getByTestId('app-shell.nav.settings-link').click()
        // Expected: After step 3 device B shows [user.settings.locale-select] with [value:es], with
        //   no choice made on device B
        await expect(b.getByTestId('user.settings.locale-select')).toHaveAttribute(
          'data-value',
          'es',
          { timeout: 10_000 },
        )

        return b
      })

    await test.step('4. On device A, choose [value:en] in [user.settings.locale-select]', async () => {
      const loads = pageLoads(deviceB)

      await expect(select).toBeEnabled()
      await select.click()
      await page
        .locator('[data-testid="user.settings.locale-select.option"][data-value="en"]')
        .click()
      // Expected: After step 4 device B shows [user.settings.locale-select] with [value:en], without
      //   a reload
      await expect(deviceB.getByTestId('user.settings.locale-select')).toHaveAttribute(
        'data-value',
        'en',
        { timeout: 10_000 },
      )
      expect(loads()).toBe(0)
    })
  })
})
