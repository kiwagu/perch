// scenario: user/base/reset-link-after-email-change
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Open a reset link after the email changed', { tag: '@full' }, () => {
  test('A reset link mailed to the old email stops working once the new email is confirmed', async ({
    page,
  }) => {
    const data = {
      ...generate.account(),
      name: generate.name(),
      newEmail: generate.newEmail(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      await askForReset(page, data.email)
      // Expected: After step 2 [mail:request-password-reset] reaches the email, after the
      //   sign-up's (step 5 holds it to its declaration)
      await mailbox.next(data.email, 1)
    })

    await test.step('3. Open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await askToChangeEmail(page, data.newEmail, data.password)
    })

    await test.step('4. Open the link of [mail:change-email]', async () => {
      await openChangeEmailMail(page, data)
      // Expected: After step 4 [user.confirm-email.message] carries [code:email-changed]
      await expect(page.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
    })

    await test.step('5. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(page, data.email, 1)
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 5 [user.reset-password.error] carries [code:link-invalid] and
      //   [user.reset-password.forgot-link] shows
      await expect(page.getByTestId('user.reset-password.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.reset-password.forgot-link')).toBeVisible()
    })
  })
})
