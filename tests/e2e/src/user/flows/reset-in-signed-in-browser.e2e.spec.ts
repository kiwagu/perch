// scenario: user/flows/reset-in-signed-in-browser
import { generate } from '../../support/data'
import { expect, expectPathname, notice, signUp, test } from '../../support/fixtures'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Set a new password from a browser that is still signed in', { tag: '@full' }, () => {
  test('A device still signed in to the account can set a new password from the mail; it is signed out by it and signs in again with the new password', async ({
    page,
    freshDevice,
  }) => {
    // A sign-in waits for the sync channel to come up.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
      await expect(page.getByTestId('app-shell.nav')).toBeVisible()
    })

    await test.step('2. On device B, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      await askForReset(await freshDevice.open(), data.email)
    })

    await test.step('3. On device A, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(page, data.email, 1)
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 3 [user.reset-password.message] carries [code:password-reset], and
      //   device A is signed out: [app-shell.nav] no longer shows
      await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
      await expect(page.getByTestId('app-shell.nav')).toHaveCount(0, { timeout: 10_000 })
      await expectPathname(page, '/reset-password')
    })

    await test.step('4. On device A, click [user.reset-password.sign-in-link], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.reset-password.sign-in-link').click()
      await expectPathname(page, '/sign-in')
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.newPassword)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, '/me')
    })
  })
})
