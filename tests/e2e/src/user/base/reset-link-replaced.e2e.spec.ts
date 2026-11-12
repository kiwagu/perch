// scenario: user/base/reset-link-replaced
import { generate } from '../../support/data'
import { appReady, expect, signOut, signUp, test } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'
import {
  enterNewPassword,
  openResetMail,
  resetRequested,
  sendResetRequest,
} from '../../support/password-reset'

test.describe('Ask for the reset mail twice', { tag: '@full' }, () => {
  test('Only the newest reset link works: an earlier one says it does not', async ({ page }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button] twice', async () => {
      await page.goto('/forgot-password')
      await appReady(page)
      await page.getByTestId('user.forgot-password.email-input').fill(data.email)

      for (const seen of [1, 2]) {
        await sendResetRequest(page)
        await expect(resetRequested(page)).toBeVisible()
        // The request's mail has arrived, after the sign-up's and the earlier request's.
        await mailbox.next(data.email, seen)
      }
    })

    await test.step('3. Open the link of the first [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(page, data.email, 1)
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 3 [user.reset-password.error] carries [code:link-invalid] and
      //   [user.reset-password.forgot-link] shows
      await expect(page.getByTestId('user.reset-password.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.reset-password.forgot-link')).toBeVisible()
    })

    await test.step('4. Open the link of the second [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(page, data.email, 2)
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 4 [user.reset-password.message] carries [code:password-reset]
      await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
      await expect(page.getByTestId('user.reset-password.error')).toHaveCount(0)
    })
  })
})
