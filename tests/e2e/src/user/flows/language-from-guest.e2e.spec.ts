// scenario: user/flows/language-from-guest
import { generate } from '../../support/data'
import { appReady, checkYourMail, expect, expectPathname, test } from '../../support/fixtures'
import { expectDeclaredMail, openDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'

test.describe('Start a new account in the language chosen as a guest', { tag: '@full' }, () => {
  test('The language chosen on the sign-in page is the language of the verification mail and the one the new account starts with, on the device that opens the link and on every other', async ({
    page,
    anotherAccount,
  }) => {
    const data = { ...generate.account(), name: generate.name() }
    // The sign-up's mail goes to the email, in the language the sign-up was made in.
    const signedUp = { params: { email: data.email, locale: 'es' } }

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
      // Expected: After step 3 device A stays on [/sign-in] with [user.sign-in.mail-message]
      //   carrying [code:check-your-mail], and [mail:sign-up] reaches the email in the language
      //   [value:es]
      await expect(checkYourMail(page)).toBeVisible()
      await expect(page).toHaveURL(/\/sign-in$/)
      expectDeclaredMail(await mailbox.next(data.email, 0), 'sign-up', signedUp)
    })

    await test.step('4. On device B, open the link of [mail:sign-up]', async () => {
      const deviceB = await anotherAccount.open()

      await openDeclaredMail(deviceB, 'sign-up', signedUp)
      // Expected: After step 4 device B is on [/me], and its [/settings] shows
      //   [user.settings.locale-select] with [value:es], with no choice made on device B
      await expectPathname(deviceB, '/me')
      await deviceB.getByTestId('app-shell.nav.settings-link').click()
      await expect(deviceB.getByTestId('user.settings.locale-select')).toHaveAttribute(
        'data-value',
        'es',
        { timeout: 10_000 },
      )
    })

    await test.step('5. On device A, enter the password into [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 5 device A is on [/me], and its [/settings] shows
      //   [user.settings.locale-select] with [value:es]
      await page.waitForURL('**/me')
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.locale-select')).toHaveAttribute(
        'data-value',
        'es',
        { timeout: 10_000 },
      )
    })
  })
})
