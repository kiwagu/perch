// scenario: user/base/change-email-refused
import { generate } from '../../support/data'
import { emailChangeRequested } from '../../support/email-change'
import { expect, signOut, signUp, test } from '../../support/fixtures'
import { expectBoundedNonArrival } from '../../support/mailbox'

test.describe('Ask to change the email with a wrong password, and to an email that has an account', {
  tag: '@full',
}, () => {
  test('A wrong password is refused under it; a new email that has an account gets the same answer as a free one, and no mail', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      otherEmail: generate.otherEmail(),
      otherPassword: generate.otherPassword(),
      wrongPassword: generate.wrongPassword(),
    }
    const email = page.getByTestId('user.settings.email.email-input')
    const password = page.getByTestId('user.settings.email.password-input')
    const send = page.getByTestId('user.settings.email.send-button')
    const error = page.getByTestId('user.settings.email.error')

    await test.step('1. Sign up with the other email, the other password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, { ...data, email: data.otherEmail, password: data.otherPassword })
      await signOut(page)
    })

    await test.step('2. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('3. Enter the other email into [user.settings.email.email-input] and the wrong password into [user.settings.email.password-input], and click [user.settings.email.send-button]', async () => {
      await email.fill(data.otherEmail)
      await password.fill(data.wrongPassword)
      await send.click()
      // Expected: After step 3 [user.settings.email.error] carries [code:invalid-credentials]
      //   under [user.settings.email.password-input]
      await expect(error).toHaveAttribute('data-code', 'invalid-credentials')

      const [field, message] = await Promise.all([password.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the password',
      ).toBe(true)
      await expect(password).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByTestId('user.settings.email.message')).toHaveCount(0)
    })

    await test.step('4. Enter the password into [user.settings.email.password-input] and click [user.settings.email.send-button]', async () => {
      await password.fill(data.password)
      await send.click()
      // Expected: After step 4 [user.settings.email.message] carries [code:check-your-mail], and
      //   no [mail:change-email] reaches the other email
      await expect(emailChangeRequested(page)).toBeVisible()

      // The message shows once the gateway answered the request.
      const answeredAt = Date.now()

      await expect(error).toHaveCount(0)
      // Within the delivery window after that answer the other email still holds the mail of its
      // sign-up alone (bounded non-arrival).
      await expectBoundedNonArrival(data.otherEmail, { mails: 1, answeredAt })
    })
  })
})
