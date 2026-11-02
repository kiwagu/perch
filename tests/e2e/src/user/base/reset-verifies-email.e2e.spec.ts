// scenario: user/base/reset-verifies-email
import { generate } from '../../support/data'
import { appReady, expect, expectPathname, notice, startSignUp, test } from '../../support/fixtures'
import { openDeclaredMail } from '../../support/mail-contract'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Reset the password of an account not verified yet', { tag: '@full' }, () => {
  test("The reset link proves the mailbox: the email is verified by it, the first sign-in anywhere makes the account's profile and settings from the sign-up, and the sign-up link no longer signs in", async ({
    page,
    freshDevice,
  }) => {
    // Device B makes the account's profile and settings once its first pull has settled.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. On device A, open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password twice and the name into [user.sign-in.email-input], [user.sign-in.password-input], [user.sign-in.password-confirmation-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await startSignUp(page, data)
    })

    await test.step('2. On device A, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      // Expected: After step 2 [user.forgot-password.message] carries [code:check-your-mail], and
      //   [mail:request-password-reset] reaches the email (step 3 waits for it, after the
      //   sign-up's)
      await askForReset(page, data.email)
    })

    await test.step('3. On device A, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(page, data.email, 1)
      await enterNewPassword(page, data.newPassword)
      // Expected: After step 3 [user.reset-password.message] carries [code:password-reset]
      await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
    })

    const deviceB =
      await test.step('4. On device B, open [/sign-in], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
        const b = await freshDevice.open()

        await b.goto('/sign-in')
        await appReady(b)
        await b.getByTestId('user.sign-in.email-input').fill(data.email)
        await b.getByTestId('user.sign-in.password-input').fill(data.newPassword)
        await b.getByTestId('user.sign-in.submit-button').click()
        // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] on device B,
        //   its URL is [/me], [user.profile.email-input] holds the email and
        //   [user.profile.name-input] holds the name
        await expect(notice(b, 'welcome')).toBeVisible({ timeout: 15_000 })
        await expectPathname(b, '/me')
        // The profile comes once the first pull has settled, about a round trip after /me opens.
        await expect(b.getByTestId('user.profile.email-input')).toHaveValue(data.email, {
          timeout: 15_000,
        })
        await expect(b.getByTestId('user.profile.name-input')).toHaveValue(data.name)

        return b
      })

    await test.step('5. On device B, click [app-shell.nav.settings-link]', async () => {
      const language = deviceB.getByTestId('user.settings.locale-select')

      await deviceB.getByTestId('app-shell.nav.settings-link').click()
      await expectPathname(deviceB, '/settings')
      // Expected: After step 5 [user.settings.locale-select] shows [value:en] on device B; the
      //   select takes a choice once the account's settings are on the device
      await expect(language).toBeEnabled({ timeout: 15_000 })
      await expect(language).toHaveAttribute('data-value', 'en')
    })

    await test.step('6. On device A, open the link of [mail:sign-up]', async () => {
      // The email's first mail, its sign-up's, in the language of the sign-up.
      await openDeclaredMail(page, 'sign-up', { params: { email: data.email, locale: 'en' } }, 0)
      // Expected: After step 6 [user.verify-email.message] carries [code:verified-before] on
      //   device A, its URL stays [/verify-email] and [user.verify-email.sign-in-link] shows
      await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
        'data-code',
        'verified-before',
      )
      await expectPathname(page, '/verify-email')
      await expect(page.getByTestId('user.verify-email.sign-in-link')).toBeVisible()
    })
  })
})
