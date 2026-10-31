// scenario: user/base/resend-same-answer
import type { Page, Response } from '@playwright/test'

import { generate } from '../../support/data'
import { checkYourMail, expect, expectPathname, signUp, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { expectBoundedNonArrival, mailbox } from '../../support/mailbox'

/**
 * Clicks the resend button and waits up to 10 s for the gateway's answer to that resend, the
 * page's POST to the resend endpoint, waited for from before the click; resolves the answer and
 * the moment the test saw it.
 */
async function resend(
  page: Page,
): Promise<{ readonly answer: Response; readonly answeredAt: number }> {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/auth/send-verification-email'),
    { timeout: 10_000 },
  )

  await page.getByTestId('user.verify-email.resend-button').click()

  const answer = await answered

  return { answer, answeredAt: Date.now() }
}

/**
 * What the page shows once the gateway accepted a resend (202, the same answer for any email): the
 * button enabled again (the page has left its sending state and shows that answer), the message,
 * no error, and the page still on /verify-email.
 */
async function expectResent(page: Page, answer: Response): Promise<void> {
  expect(answer.status(), 'the gateway accepted the resend').toBe(202)
  await expect(page.getByTestId('user.verify-email.resend-button')).toBeEnabled()
  await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
    'data-code',
    'check-your-mail',
  )
  await expect(page.getByTestId('user.verify-email.error')).toHaveCount(0)
  await expectPathname(page, '/verify-email')
}

test.describe('Ask for a new verification link for any email', { tag: '@full' }, () => {
  test('A resend for an unknown email, or for one verified already, answers as a resend for an email waiting for its link does, and sends no mail', async ({
    page,
  }) => {
    // A sign-out waits for the sync channel first.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      otherEmail: generate.email(),
      unknownEmail: generate.email(),
    }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [user.profile.sign-out-button]', async () => {
      await signUp(page, data)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.name)
      await page.getByTestId('user.profile.sign-out-button').click()
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
    })

    await test.step('2. Click [user.sign-in.toggle-button], enter the other email, the password and the name into [user.sign-in.email-input], [user.sign-in.password-input] and [user.sign-in.name-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.sign-in.toggle-button').click()
      await page.getByTestId('user.sign-in.email-input').fill(data.otherEmail)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.name-input').fill(data.name)
      await page.getByTestId('user.sign-in.submit-button').click()
      await expect(checkYourMail(page)).toBeVisible()
    })

    await test.step('3. Open [/verify-email] with a made-up token', async () => {
      await page.goto('/verify-email?token=made.up.token')
      // Expected: After step 3 [user.verify-email.error] carries [code:link-invalid]
      await expect(page.getByTestId('user.verify-email.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
    })

    await test.step('4. Enter the other email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.otherEmail)

      const { answer } = await resend(page)

      // Expected: After step 4 [user.verify-email.message] carries [code:check-your-mail], no
      //   [user.verify-email.error] shows, and [mail:resend-verification] reaches the other email
      await expectResent(page, answer)
      // The other email's first mail is its sign-up's; the resend's comes after it, in the
      // language the account signed up in.
      expectDeclaredMail(await mailbox.next(data.otherEmail, 1), 'resend-verification', {
        params: { email: data.otherEmail },
        account: { email: data.otherEmail, language: 'en' },
      })
    })

    await test.step('5. Enter the unknown email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.unknownEmail)

      const { answer, answeredAt } = await resend(page)

      // Expected: After step 5 and after step 6 the page shows what it showed after step 4:
      //   [user.verify-email.message] carries [code:check-your-mail], no
      //   [user.verify-email.error] shows, and the URL stays [/verify-email]
      await expectResent(page, answer)
      // - No [mail:resend-verification] reaches the unknown email: none within the delivery
      //   window after the answer (bounded non-arrival)
      await expectBoundedNonArrival(data.unknownEmail, { mails: 0, answeredAt })
    })

    await test.step('6. Enter the email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.email)

      const { answer, answeredAt } = await resend(page)

      await expectResent(page, answer)
      // - No [mail:resend-verification] reaches the email: within the delivery window after the
      //   answer it still holds the mail of its sign-up alone (bounded non-arrival)
      await expectBoundedNonArrival(data.email, { mails: 1, answeredAt })
    })
  })
})
