// scenario: user/base/taken-email
import { generate } from '../../support/data'
import { checkYourMail, expect, notice, signUp, test } from '../../support/fixtures'
import { mailbox } from '../../support/mailbox'

test.describe('Sign up again with an email that has an account', { tag: '@smoke' }, () => {
  test('A sign-up with a taken email answers as a new one does, sends no mail, and the account keeps its own password', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      otherPassword: generate.otherPassword(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
      await page.getByTestId('user.profile.sign-out-button').click()
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    })

    await test.step('2. Click [user.sign-in.toggle-button], enter the email, the other password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.toggle-button').click()
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.otherPassword)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 2 [user.sign-in.mail-message] carries [code:check-your-mail], as after
      //   the sign-up of a new email, the URL stays [/sign-in], and no second [mail:sign-up] reaches
      //   the email
      await expect(checkYourMail(page)).toBeVisible()
      await expect(page).toHaveURL(/\/sign-in$/)
      // The gateway does not await its sends: a mail that would come comes within a second on the
      // stand, so after two seconds the mailbox holds every mail the sign-up made go out.
      await page.waitForTimeout(2_000)
      expect(await mailbox.count(data.email), 'the mails to the email').toBe(1)
    })

    await test.step('3. Enter the other password into [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.password-input').fill(data.otherPassword)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 3 [user.sign-in.error] carries [code:invalid-credentials]
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'invalid-credentials',
      )
    })

    await test.step('4. Enter the password into [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 4 [app-shell.notice-message] carries [code:welcome] and the URL is
      //   [/me]
      await expect(notice(page, 'welcome')).toBeVisible()
      await expect(page).toHaveURL(/\/me$/)
    })
  })
})
