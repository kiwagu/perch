// scenario: user/flows/language-across-devices
import { appReady, expect, test } from '../../support/fixtures'

test.describe('Keep the language of an account on every device', { tag: '@full' }, () => {
  test('A language chosen on one device is the language of the account on the next device it signs in on', async ({
    page,
    secondDevice,
  }) => {
    await test.step('1. On device A, open [/me] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.getByTestId('user.profile.heading')).toBeVisible()
    })

    await test.step('2. On device A, choose [value:es] in [app-shell.locale-select]', async () => {
      await page.getByTestId('app-shell.locale-select').click()
      await page.locator('[data-testid="app-shell.locale-select.option"][data-value="es"]').click()
      // Expected: After step 2 device A shows [app-shell.locale-select] with [value:es] at once
      await expect(page.getByTestId('app-shell.locale-select')).toHaveAttribute('data-value', 'es')
    })

    await test.step('3. On device B, sign in with the same account and wait for [/me]', async () => {
      const deviceB = await secondDevice.signIn()

      // Expected: After step 3 device B shows [app-shell.locale-select] with [value:es], with no
      //   choice made on device B
      await expect(deviceB.getByTestId('app-shell.locale-select')).toHaveAttribute(
        'data-value',
        'es',
        { timeout: 10_000 },
      )
    })
  })
})
