// scenario: user/base/reset-password-rules
import { generate } from '../../support/data'
import { expect, signOut, signUp, test } from '../../support/fixtures'
import { askForReset, openResetMail } from '../../support/password-reset'

test.describe('Keep the rules and type the new password twice on the reset page', {
  tag: '@full',
}, () => {
  test('The reset page holds the new password to its rules and to the password typed again before it sets it', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
      otherPassword: generate.otherPassword(),
      lowercaseOnly: 'abcdefghij',
    }
    const password = page.getByTestId('user.reset-password.password-input')
    const confirmation = page.getByTestId('user.reset-password.password-confirmation-input')
    const submit = page.getByTestId('user.reset-password.submit-button')
    const error = page.getByTestId('user.reset-password.error')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. Open [/forgot-password], enter the email into [user.forgot-password.email-input], click [user.forgot-password.send-button], and open the link of [mail:request-password-reset]', async () => {
      await askForReset(page, data.email)
      await openResetMail(page, data.email, 1)
    })

    await test.step('3. Enter the lowercase only into [user.reset-password.password-input]', async () => {
      await password.fill(data.lowercaseOnly)
      // Expected: After step 3 [user.reset-password.password-rule-list.lowercase-item] carries
      //   [state:met], [user.reset-password.password-rule-list.digit-item] does not, and
      //   [user.reset-password.submit-button] is disabled
      await expect(
        page.getByTestId('user.reset-password.password-rule-list.lowercase-item'),
      ).toHaveAttribute('data-state', 'met')
      await expect(
        page.getByTestId('user.reset-password.password-rule-list.digit-item'),
      ).not.toHaveAttribute('data-state')
      await expect(submit).toBeDisabled()
    })

    await test.step('4. Enter the new password into [user.reset-password.password-input] and the other password into [user.reset-password.password-confirmation-input]', async () => {
      await password.fill(data.newPassword)
      await confirmation.fill(data.otherPassword)
      // Expected: After step 4 [user.reset-password.error] carries [code:passwords-differ] under
      //   [user.reset-password.password-confirmation-input] and
      //   [user.reset-password.submit-button] is disabled
      await expect(error).toHaveAttribute('data-code', 'passwords-differ')

      const [field, message] = await Promise.all([confirmation.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the password typed again',
      ).toBe(true)
      await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
      await expect(submit).toBeDisabled()
    })

    await test.step('5. Enter the new password into [user.reset-password.password-confirmation-input] and click [user.reset-password.submit-button]', async () => {
      await confirmation.fill(data.newPassword)
      await expect(error).toHaveCount(0)
      await submit.click()
      // Expected: After step 5 [user.reset-password.message] carries [code:password-reset]
      await expect(page.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
    })
  })
})
