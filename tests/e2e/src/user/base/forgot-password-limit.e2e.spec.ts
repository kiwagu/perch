// scenario: user/base/forgot-password-limit
import { generate } from '../../support/data'
import { appReady, expect, signOut, signUp, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { expectBoundedNonArrival, mailbox } from '../../support/mailbox'
import { resetRequested, sendResetRequest } from '../../support/password-reset'

test.describe('Ask for the reset mail too often', { tag: '@full' }, () => {
  test('One email takes three reset requests within a quarter of an hour; the fourth is refused and sends nothing', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }
    const values = { params: { email: data.email }, account: { email: data.email, language: 'en' } }
    const error = page.getByTestId('user.forgot-password.error')

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await signOut(page)
    })

    await test.step('2. Open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button] three times, waiting for [user.forgot-password.message] each time', async () => {
      await page.goto('/forgot-password')
      await appReady(page)
      await page.getByTestId('user.forgot-password.email-input').fill(data.email)

      // Each request's mail comes after the sign-up's and the earlier requests', in the account's
      // language.
      for (const seen of [1, 2, 3]) {
        const { answer } = await sendResetRequest(page)

        expect(answer.ok(), 'the gateway took the request').toBe(true)
        await expect(resetRequested(page)).toBeVisible()
        expectDeclaredMail(await mailbox.next(data.email, seen), 'request-password-reset', values)
      }

      // Expected: After step 2 three [mail:request-password-reset] reach the email
      expect(await mailbox.count(data.email), 'the sign-up mail and three reset mails').toBe(4)
      await expect(error).toHaveCount(0)
    })

    await test.step('3. Click [user.forgot-password.send-button] once more', async () => {
      const { answeredAt } = await sendResetRequest(page)

      // Expected: After step 3 [user.forgot-password.error] carries [code:rate-limited], and no
      //   fourth [mail:request-password-reset] reaches the email
      await expect(error).toHaveAttribute('data-code', 'rate-limited')
      // Within the delivery window after that answer the email still holds the sign-up mail and
      // the three reset mails (bounded non-arrival).
      await expectBoundedNonArrival(data.email, { mails: 4, answeredAt })
    })
  })
})
