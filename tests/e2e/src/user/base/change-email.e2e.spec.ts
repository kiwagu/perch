// scenario: user/base/change-email
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import { expect, expectPathname, notice, signOut, signUp, test } from '../../support/fixtures'
import { nextDeclaredNotice } from '../../support/notice-contract'

test.describe('Change the email in the settings', { tag: '@smoke' }, () => {
  test('The email changes once the link of the mail sent to the new email is opened; the old address is told, and the account signs in with the new email', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newEmail: generate.newEmail(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('2. Enter the new email into [user.settings.email.email-input] and the password into [user.settings.email.password-input], and click [user.settings.email.send-button]', async () => {
      // Expected: After step 2 [user.settings.email.message] carries [code:check-your-mail], and
      //   [mail:change-email] reaches the new email (step 3 waits for it)
      await askToChangeEmail(page, data.newEmail, data.password)
      await expect(page.getByTestId('user.settings.email.error')).toHaveCount(0)
    })

    await test.step('3. Open the link of [mail:change-email]', async () => {
      await openChangeEmailMail(page, data)
      // Expected: After step 3 the link opens [/confirm-email], [user.confirm-email.message]
      //   carries [code:email-changed], and [notice:confirm-email.email-changed] reaches the
      //   email, naming neither the new email nor any part of it
      await expectPathname(page, '/confirm-email')
      await expect(page.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )
      // The email's second mail, after the sign-up's, in the account's language.
      await nextDeclaredNotice(
        'confirm-email.email-changed',
        { params: {}, account: { email: data.email, language: 'en' }, hides: data.newEmail },
        1,
      )
    })

    await test.step('4. Click [user.confirm-email.profile-link]', async () => {
      await page.getByTestId('user.confirm-email.profile-link').click()
      // Expected: After step 4 the URL is [/me] and [user.profile.email-input] holds the new
      //   email
      await expectPathname(page, '/me')
      await expect(page.getByTestId('user.profile.email-input')).toHaveValue(data.newEmail, {
        timeout: 10_000,
      })
    })

    await test.step('5. Click [user.profile.sign-out-button], enter the new email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await signOut(page)
      await page.getByTestId('user.sign-in.email-input').fill(data.newEmail)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 5 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible({ timeout: 15_000 })
      await expectPathname(page, '/me')
    })
  })
})
