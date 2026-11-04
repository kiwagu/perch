// scenario: user/base/reset-link-after-email-change
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import { appReady, expect, signUp, test } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Open a reset link after the email changed', { tag: '@full' }, () => {
  test('A reset link mailed to the old email stops working once the new email is confirmed', async ({
    page,
    freshDevice,
  }) => {
    const data = {
      ...generate.account(),
      name: generate.name(),
      newEmail: generate.newEmail(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    const deviceB =
      await test.step('2. On device B, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
        const b = await freshDevice.open()

        await askForReset(b, data.email)
        // Expected: After step 2 [mail:request-password-reset] reaches the email, after the
        //   sign-up's (step 5 holds it to its declaration)
        await mailbox.next(data.email, 1)

        return b
      })

    await test.step('3. On device A, open [/settings], enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await askToChangeEmail(page, data.newEmail, data.password)
    })

    await test.step('4. On device A, open the link of [mail:change-email]', async () => {
      await openChangeEmailMail(page, data)
      // Expected: After step 4 [user.confirm-email.message] carries [code:email-changed]
      await expect(page.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
    })

    await test.step('5. On device B, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(deviceB, data.email, 1)
      await enterNewPassword(deviceB, data.newPassword)
      // Expected: After step 5 [user.reset-password.error] carries [code:link-invalid] and
      //   [user.reset-password.forgot-link] shows
      await expect(deviceB.getByTestId('user.reset-password.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(deviceB.getByTestId('user.reset-password.forgot-link')).toBeVisible()
    })
  })
})
