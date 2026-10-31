// scenario: user/base/resend-limit
import { generate } from '../../support/data'
import { checkYourMail, expect, startSignUp, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { expectBoundedNonArrival, mailbox } from '../../support/mailbox'

test.describe('Ask for the verification mail again too often', { tag: '@full' }, () => {
  test('One email takes three resends of its verification mail within a quarter of an hour; the fourth is refused and sends nothing', async ({
    page,
  }) => {
    const data = { ...generate.account(), name: generate.name() }
    const resend = page.getByTestId('user.sign-in.resend-button')

    await test.step('1. Open [/sign-in], click [user.sign-in.toggle-button], enter the email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await startSignUp(page, data)
      // Expected: After step 1 [mail:sign-up] reaches the email
      expectDeclaredMail(await mailbox.next(data.email, 0), 'sign-up', {
        params: { email: data.email, locale: 'en' },
      })
    })

    await test.step('2. Click [user.sign-in.resend-button] three times, each time once it is enabled again', async () => {
      // Each resend's mail comes after the sign-up's and the earlier resends', in the language
      // the account signed up in.
      for (const seen of [1, 2, 3]) {
        await expect(resend).toBeEnabled()
        await resend.click()
        expectDeclaredMail(await mailbox.next(data.email, seen), 'resend-verification', {
          params: { email: data.email },
          account: { email: data.email, language: 'en' },
        })
      }

      // Expected: After step 2 [user.sign-in.mail-message] carries [code:check-your-mail], no
      //   [user.sign-in.error] shows, and three [mail:resend-verification] reach the email
      await expect(resend).toBeEnabled()
      await expect(checkYourMail(page)).toBeVisible()
      await expect(page.getByTestId('user.sign-in.error')).toHaveCount(0)
      expect(await mailbox.count(data.email), 'the sign-up mail and three resends').toBe(4)
    })

    await test.step('3. Click [user.sign-in.resend-button] once more', async () => {
      await resend.click()
      // Expected: After step 3 [user.sign-in.error] carries [code:rate-limited], no
      //   [user.sign-in.mail-message] shows, [user.sign-in.resend-button] shows, and no fourth
      //   [mail:resend-verification] reaches the email
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'rate-limited',
      )

      // The error shows once the gateway answered the resend.
      const answeredAt = Date.now()

      await expect(page.getByTestId('user.sign-in.mail-message')).toHaveCount(0)
      await expect(resend).toBeVisible()
      // Within the delivery window after that answer the email still holds the sign-up mail and
      // the three resends (bounded non-arrival).
      await expectBoundedNonArrival(data.email, { mails: 4, answeredAt })
    })
  })
})
