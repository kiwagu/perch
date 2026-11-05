// scenario: user/base/forgot-password
import { generate } from '../../support/data'
import { expect, expectPathname, notice, signOut, signUp, test } from '../../support/fixtures'
import { nextDeclaredNotice } from '../../support/notice-contract'
import {
  enterNewPassword,
  openResetMail,
  resetRequested,
  sendResetRequest,
} from '../../support/password-reset'

test.describe('Set a new password through the mail', { tag: '@smoke' }, () => {
  test('A user who forgot the password asks for the mail, sets a new password from its link, and signs in with it while the old one no longer works', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }
    const account = { email: data.email, language: 'en' }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. Enter the email into [user.sign-in.email-input] and click [user.sign-in.forgot-link]', async () => {
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.forgot-link').click()
      // Expected: After step 2 the URL is [/forgot-password] and
      //   [user.forgot-password.email-input] holds the email
      await expectPathname(page, '/forgot-password')
      await expect(page.getByTestId('user.forgot-password.email-input')).toHaveValue(data.email)
    })

    await test.step('3. Click [user.forgot-password.send-button]', async () => {
      await sendResetRequest(page)
      // Expected: After step 3 [user.forgot-password.message] carries [code:check-your-mail], and
      //   [mail:request-password-reset] reaches the email (step 4 waits for it, after the
      //   sign-up's)
      await expect(resetRequested(page)).toBeVisible()
      await expect(page.getByTestId('user.forgot-password.error')).toHaveCount(0)
    })

    await test.step('4. Open the link of [mail:request-password-reset]', async () => {
      await openResetMail(page, data.email, 1)
      // Expected: After step 4 the link opens [/reset-password], with
      //   [user.reset-password.password-rule-list]
      await expectPathname(page, '/reset-password')
      await expect(page.getByTestId('user.reset-password.password-rule-list')).toBeVisible()
    })

    await test.step('5. Enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 5 [user.reset-password.message] carries [code:password-reset],
      //   [user.reset-password.sign-in-link] shows, and [notice:reset-password.password-changed]
      //   reaches the email
      await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
      await expect(page.getByTestId('user.reset-password.sign-in-link')).toBeVisible()
      // The email's third mail, after the sign-up's and the reset's, in the account's language.
      await nextDeclaredNotice('reset-password.password-changed', { params: {}, account }, 2)
    })

    await test.step('6. Click [user.reset-password.sign-in-link], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.reset-password.sign-in-link').click()
      await expectPathname(page, '/sign-in')
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 6 [user.sign-in.error] carries [code:invalid-credentials]
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'invalid-credentials',
      )
    })

    await test.step('7. Enter the new password into [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.password-input').fill(data.newPassword)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 7 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, '/me')
    })
  })
})
