// scenario: user/flows/language-from-guest
import { generate } from '../../support/data'
import { appReady, expect, signIn, test } from '../../support/fixtures'

test.describe('Start a new account in the language chosen as a guest', { tag: '@full' }, () => {
  test('A language chosen on the sign-in page is the language a new account starts with, on every device', async ({
    page,
    anotherAccount,
  }) => {
    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. On device A, open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    await test.step('2. On device A, choose [value:es] in [app-shell.locale-select]', async () => {
      await page.getByTestId('app-shell.locale-select').click()
      await page.locator('[data-testid="app-shell.locale-select.option"][data-value="es"]').click()
    })

    await test.step('3. On device A, click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.toggle-button').click()
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 3 device A is on [/me] and shows [app-shell.locale-select] with
      //   [value:es]
      await page.waitForURL('**/me')
      await expect(page.getByTestId('app-shell.locale-select')).toHaveAttribute('data-value', 'es')
    })

    await test.step('4. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      const deviceB = await anotherAccount.open()

      await signIn(deviceB, data)
      // Expected: After step 4 device B is on [/me] and shows [app-shell.locale-select] with
      //   [value:es], with no choice made on device B
      await expect(deviceB.getByTestId('app-shell.locale-select')).toHaveAttribute(
        'data-value',
        'es',
        { timeout: 10_000 },
      )
    })
  })
})
