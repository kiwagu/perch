// scenario: user/base/reset-link-used
import { generate } from '../../support/data'
import { expect, expectPathname, signOut, signUp, test } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Open a password reset link a second time', { tag: '@full' }, () => {
  test('A reset link sets a password once; opened again it says the link does not work and leads to asking for a new one', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
      otherPassword: generate.otherPassword(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      await askForReset(page, data.email)
    })

    const mail =
      await test.step('3. Open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
        const opened = await openResetMail(page, data.email, 1)

        await enterNewPassword(page, data.newPassword)
        // Expected: After step 3 [user.reset-password.message] carries [code:password-reset]
        await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
          'data-code',
          'password-reset',
        )

        return opened
      })

    await test.step('4. Open the same link again, enter the other password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openMailLink(page, mail, 'request-password-reset')
      await enterNewPassword(page, data.otherPassword)
      // Expected: After step 4 [user.reset-password.error] carries [code:link-invalid] and
      //   [user.reset-password.forgot-link] shows
      await expect(page.getByTestId('user.reset-password.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.reset-password.forgot-link')).toBeVisible()
    })

    await test.step('5. Click [user.reset-password.forgot-link]', async () => {
      await page.getByTestId('user.reset-password.forgot-link').click()
      // Expected: After step 5 the URL is [/forgot-password]
      await expectPathname(page, '/forgot-password')
    })
  })
})
