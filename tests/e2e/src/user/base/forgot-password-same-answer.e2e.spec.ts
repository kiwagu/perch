// scenario: user/base/forgot-password-same-answer
import { generate } from '../../support/data'
import { appReady, expect, test } from '../../support/fixtures'
import { expectBoundedNonArrival } from '../../support/mailbox'
import { resetRequested, sendResetRequest } from '../../support/password-reset'

test.describe('Ask for a new password for an email that has no account', { tag: '@smoke' }, () => {
  test('The page answers an unknown email as it answers one that has an account, and sends no mail', async ({
    page,
  }) => {
    const data = {
      email: generate.email(),
    }

    await test.step('1. Open [/forgot-password] and wait for [app-shell.status] to reach [state:ready]', async () => {
      await page.goto('/forgot-password')
      await appReady(page)
    })

    await test.step('2. Enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
      await page.getByTestId('user.forgot-password.email-input').fill(data.email)

      const { answeredAt } = await sendResetRequest(page)

      // Expected: After step 2 [user.forgot-password.message] carries [code:check-your-mail], and
      //   no [mail:request-password-reset] reaches the email
      await expect(resetRequested(page)).toBeVisible()
      await expect(page.getByTestId('user.forgot-password.error')).toHaveCount(0)
      // Within the delivery window after the answer the email holds no mail (bounded
      // non-arrival).
      await expectBoundedNonArrival(data.email, { mails: 0, answeredAt })
    })
  })
})
