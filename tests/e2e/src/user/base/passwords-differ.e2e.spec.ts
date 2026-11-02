// scenario: user/base/passwords-differ
import { generate } from '../../support/data'
import { appReady, checkYourMail, expect, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { expectBoundedNonArrival, mailbox } from '../../support/mailbox'

test.describe('Sign up with the password typed again differently', { tag: '@smoke' }, () => {
  test('The password typed again is checked as it is typed, and the account is asked for only once the two are the same', async ({
    page,
  }) => {
    const data = {
      email: generate.email(),
      password: generate.password(),
      name: generate.name(),
    }
    const email = page.getByTestId('user.sign-in.email-input')
    const password = page.getByTestId('user.sign-in.password-input')
    const confirmation = page.getByTestId('user.sign-in.password-confirmation-input')
    const name = page.getByTestId('user.sign-in.name-input')
    const submit = page.getByTestId('user.sign-in.submit-button')
    const toggle = page.getByTestId('user.sign-in.toggle-button')
    const error = page.getByTestId('user.sign-in.error')
    const begun = data.password.slice(0, -1)
    const last = data.password.slice(-1)

    await test.step('1. Open [/sign-in] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/sign-in')
      await appReady(page)
    })

    await test.step('2. Click [user.sign-in.toggle-button]', async () => {
      await expect(toggle).toHaveAttribute('data-value', 'sign-up')
      await toggle.click()
    })

    await test.step('3. Enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input]', async () => {
      await email.fill(data.email)
      await password.fill(data.password)
      await name.fill(data.name)
    })

    await test.step('4. Type the password without its last character into [user.sign-in.password-confirmation-input], one character at a time', async () => {
      for (const character of begun) {
        await confirmation.pressSequentially(character)
        // Expected: During step 4 no [user.sign-in.error] shows
        await expect(error).toHaveCount(0)
      }

      await expect(confirmation).toHaveValue(begun)
    })

    await test.step('5. Click [user.sign-in.submit-button]', async () => {
      await submit.click()
      // Expected: After step 5 [user.sign-in.error] carries [code:passwords-differ] under
      //   [user.sign-in.password-confirmation-input], which is marked invalid;
      //   [user.sign-in.submit-button] is disabled, [user.sign-in.toggle-button] still carries
      //   [value:sign-in], the fields keep what was typed, no [user.sign-in.mail-message] shows,
      //   and no [mail:sign-up] reaches the email
      await expect(error).toHaveAttribute('data-code', 'passwords-differ')

      // The page answered the submit with its error, asking the gateway nothing.
      const answeredAt = Date.now()
      const [field, message] = await Promise.all([confirmation.boundingBox(), error.boundingBox()])

      expect(
        field !== null && message !== null && message.y >= field.y + field.height,
        'the error shows under the password typed again',
      ).toBe(true)
      await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
      await expect(submit).toBeDisabled()
      await expect(toggle).toHaveAttribute('data-value', 'sign-in')
      await expect(email).toHaveValue(data.email)
      await expect(password).toHaveValue(data.password)
      await expect(confirmation).toHaveValue(begun)
      await expect(name).toHaveValue(data.name)
      await expect(page.getByTestId('user.sign-in.mail-message')).toHaveCount(0)
      // Within the delivery window after that answer the email holds no mail (bounded
      // non-arrival).
      await expectBoundedNonArrival(data.email, { mails: 0, answeredAt })
    })

    await test.step('6. Type the last character of the password into [user.sign-in.password-confirmation-input]', async () => {
      await confirmation.press('End')
      await confirmation.pressSequentially(last)
      // Expected: After step 6 no [user.sign-in.error] shows and [user.sign-in.submit-button] is
      //   enabled
      await expect(confirmation).toHaveValue(data.password)
      await expect(error).toHaveCount(0)
      await expect(confirmation).not.toHaveAttribute('aria-invalid', 'true')
      await expect(submit).toBeEnabled()
    })

    await test.step('7. Type one more character into [user.sign-in.password-confirmation-input]', async () => {
      await confirmation.pressSequentially('x')
      // Expected: After step 7 [user.sign-in.error] carries [code:passwords-differ] at once (on
      //   the keystroke, no submit) and [user.sign-in.submit-button] is disabled
      await expect(error).toHaveAttribute('data-code', 'passwords-differ')
      await expect(confirmation).toHaveAttribute('aria-invalid', 'true')
      await expect(submit).toBeDisabled()
    })

    await test.step('8. Delete that character from [user.sign-in.password-confirmation-input] and click [user.sign-in.submit-button]', async () => {
      await confirmation.press('Backspace')
      await expect(confirmation).toHaveValue(data.password)
      await submit.click()
      // Expected: After step 8 no [user.sign-in.error] shows, [user.sign-in.mail-message] carries
      //   [code:check-your-mail], and [mail:sign-up] reaches the email
      await expect(checkYourMail(page)).toBeVisible()
      await expect(error).toHaveCount(0)
      expectDeclaredMail(await mailbox.next(data.email, 0), 'sign-up', {
        params: { email: data.email, locale: 'en' },
      })
    })
  })
})
