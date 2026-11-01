// scenario: user/base/verify-link-invalid
import { generate } from '../../support/data'
import { expect, expectPathname, notice, startSignUp, test } from '../../support/fixtures'
import { expectDeclaredMail, openDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'

test.describe('Open a verification link that does not work', { tag: '@smoke' }, () => {
  test('A broken link says so and sends a new one, whose link signs in', async ({ page }) => {
    const data = { ...generate.account(), name: generate.name() }
    // The resend's mail goes to the email, in the language the account signed up in.
    const resent = {
      params: { email: data.email },
      account: { email: data.email, language: 'en' },
    }

    await test.step('1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await startSignUp(page, data)
    })

    await test.step('2. Open [/verify-email] with a made-up token', async () => {
      await page.goto('/verify-email?token=made.up.token')
      // Expected: After step 2 [user.verify-email.error] carries [code:link-invalid], with
      //   [user.verify-email.email-input] and [user.verify-email.resend-button]
      await expect(page.getByTestId('user.verify-email.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.verify-email.email-input')).toBeVisible()
      await expect(page.getByTestId('user.verify-email.resend-button')).toBeVisible()
    })

    await test.step('3. Enter the email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.email)
      await page.getByTestId('user.verify-email.resend-button').click()
      // Expected: After step 3 [user.verify-email.message] carries [code:check-your-mail] and
      //   [mail:resend-verification] reaches the email
      await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
        'data-code',
        'check-your-mail',
      )
      expectDeclaredMail(await mailbox.next(data.email, 1), 'resend-verification', resent)
    })

    await test.step('4. Open the link of [mail:resend-verification]', async () => {
      await openDeclaredMail(page, 'resend-verification', resent, 1)
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible()
      await expectPathname(page, '/me')
    })
  })
})
