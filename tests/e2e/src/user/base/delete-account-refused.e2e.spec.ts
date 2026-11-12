// scenario: user/base/delete-account-refused
import { deletionRequested, sendDeletionRequest } from '../../support/account-deletion'
import { generate } from '../../support/data'
import { expect, signUp, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { expectBoundedNonArrival, mailbox } from '../../support/mailbox'

test.describe('Ask to delete the account with a wrong password', { tag: '@full' }, () => {
  test('A wrong password is refused under it and sends no mail; the right one sends the mail', async ({
    page,
  }) => {
    const data = {
      ...generate.account(),
      name: generate.name(),
      wrongPassword: generate.wrongPassword(),
    }
    const password = page.getByTestId('user.settings.deletion.password-input')
    const error = page.getByTestId('user.settings.deletion.error')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('2. Enter the wrong password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]', async () => {
      const answeredAt = await sendDeletionRequest(page, data.wrongPassword)

      // Expected: After step 2 [user.settings.deletion.error] carries [code:invalid-credentials]
      //   under [user.settings.deletion.password-input], and no [mail:request-account-deletion]
      //   reaches the email
      await expect(error).toHaveAttribute('data-code', 'invalid-credentials')

      const [field, message] = await Promise.all([password.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the password',
      ).toBe(true)
      await expect(password).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByTestId('user.settings.deletion.message')).toHaveCount(0)
      // Within the delivery window after the gateway's answer the email still holds the mail of
      // its sign-up alone (bounded non-arrival).
      await expectBoundedNonArrival(data.email, { mails: 1, answeredAt })
    })

    await test.step('3. Clear [user.settings.deletion.password-input], enter the password into it and click [user.settings.deletion.send-button]', async () => {
      await password.clear()
      await sendDeletionRequest(page, data.password)
      // Expected: After step 3 [user.settings.deletion.message] carries [code:check-your-mail]
      //   and [mail:request-account-deletion] reaches the email
      await expect(deletionRequested(page)).toBeVisible()
      await expect(error).toHaveCount(0)
      // The email's second mail, after the sign-up's, in the account's language.
      expectDeclaredMail(await mailbox.next(data.email, 1), 'request-account-deletion', {
        params: {},
        account: { email: data.email, language: 'en' },
      })
    })
  })
})
