// scenario: user/base/sign-in-unverified
import { generate } from '../../support/data'
import { appReady, checkYourMail, expect, notice, startSignUp, test } from '../../support/fixtures'
import { expectDeclaredMail, openDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'

test.describe('Sign in before the email is verified', { tag: '@smoke' }, () => {
  test('An account whose email is not verified cannot sign in; the page sends the mail again, and its link signs in', async ({
    page,
  }) => {
    const data = { ...generate.account(), name: generate.name() }
    // The resend's mail goes to the email, in the language the account signed up in.
    const resent = {
      params: { email: data.email },
      account: { email: data.email, language: 'en' },
    }

    await test.step('1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await startSignUp(page, data)
    })

    await test.step('2. Reload the page, enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.reload()
      await appReady(page)
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 2 [user.sign-in.error] carries [code:email-not-verified],
      //   [user.sign-in.resend-button] shows and the URL stays [/sign-in]
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'email-not-verified',
      )
      await expect(page.getByTestId('user.sign-in.resend-button')).toBeVisible()
      await expect(page).toHaveURL(/\/sign-in$/)
    })

    await test.step('3. Click [user.sign-in.resend-button]', async () => {
      await page.getByTestId('user.sign-in.resend-button').click()
      // Expected: After step 3 [user.sign-in.mail-message] carries [code:check-your-mail], the
      //   error of step 2 is gone (no [user.sign-in.error] shows), and [mail:resend-verification]
      //   reaches the email
      await expect(checkYourMail(page)).toBeVisible()
      await expect(page.getByTestId('user.sign-in.error')).toHaveCount(0)
      expectDeclaredMail(await mailbox.next(data.email, 1), 'resend-verification', resent)
    })

    await test.step('4. Open the link of [mail:resend-verification]', async () => {
      await openDeclaredMail(page, 'resend-verification', resent, 1)
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible()
      await expect(page).toHaveURL(/\/me$/)
    })
  })
})
