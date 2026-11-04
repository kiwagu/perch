// scenario: user/base/change-password
import { generate } from '../../support/data'
import {
  expect,
  expectPathname,
  notice,
  signOut,
  signUp,
  test,
  toast,
} from '../../support/fixtures'
import { nextDeclaredNotice } from '../../support/notice-contract'

test.describe('Change the password in the settings', { tag: '@smoke' }, () => {
  test('The password changes only with the current one right; the toast says so, and the account then signs in with the new one', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
      wrongPassword: generate.wrongPassword(),
    }
    const current = page.getByTestId('user.settings.password.current-password-input')
    const newPassword = page.getByTestId('user.settings.password.new-password-input')
    const confirmation = page.getByTestId('user.settings.password.password-confirmation-input')
    const save = page.getByTestId('user.settings.password.save-button')
    const error = page.getByTestId('user.settings.password.error')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('2. Enter the wrong password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]', async () => {
      await current.fill(data.wrongPassword)
      await newPassword.fill(data.newPassword)
      await confirmation.fill(data.newPassword)
      await save.click()
      // Expected: After step 2 [user.settings.password.error] carries [code:invalid-credentials]
      //   under [user.settings.password.current-password-input]
      await expect(error).toHaveAttribute('data-code', 'invalid-credentials')

      const [field, message] = await Promise.all([current.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the current password',
      ).toBe(true)
      await expect(current).toHaveAttribute('aria-invalid', 'true')
    })

    await test.step('3. Enter the password into [user.settings.password.current-password-input] and click [user.settings.password.save-button]', async () => {
      await current.fill(data.password)
      await save.click()
      // Expected: After step 3 [app-shell.toast] carries [code:password-changed], the fields of
      //   [user.settings.password.form] are empty, and [notice:change-password.password-changed]
      //   reaches the email
      await expect(toast(page, 'password-changed')).toBeVisible()
      await expect(current).toHaveValue('')
      await expect(newPassword).toHaveValue('')
      await expect(confirmation).toHaveValue('')
      await expect(error).toHaveCount(0)
      // The email's second mail, after the sign-up's, in the account's language.
      await nextDeclaredNotice(
        'change-password.password-changed',
        { params: {}, account: { email: data.email, language: 'en' } },
        1,
      )
    })

    await test.step('4. Click [app-shell.nav.profile-link], click [user.profile.sign-out-button], enter the email and the new password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('app-shell.nav.profile-link').click()
      await expectPathname(page, '/me')
      await signOut(page)
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
