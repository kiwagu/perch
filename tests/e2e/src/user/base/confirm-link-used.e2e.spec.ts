// scenario: user/base/confirm-link-used
import { generate } from '../../support/data'
import { askToChangeEmail, openChangeEmailMail } from '../../support/email-change'
import { expect, signUp, test } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'

test.describe('Open an email confirmation link a second time', { tag: '@full' }, () => {
  test('A confirmation link changes the email once; opened again it says it does not work', async ({
    page,
  }) => {
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
      await askToChangeEmail(page, data.newEmail, data.password)
    })

    const mail = await test.step('3. Open the link of [mail:change-email]', async () => {
      const opened = await openChangeEmailMail(page, data)

      // Expected: After step 3 [user.confirm-email.message] carries [code:email-changed]
      await expect(page.getByTestId('user.confirm-email.message')).toHaveAttribute(
        'data-code',
        'email-changed',
      )

      return opened
    })

    await test.step('4. Open the same link again', async () => {
      await openMailLink(page, mail, 'change-email')
      // Expected: After step 4 [user.confirm-email.error] carries [code:link-invalid]
      await expect(page.getByTestId('user.confirm-email.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.confirm-email.message')).toHaveCount(0)
    })
  })
})
