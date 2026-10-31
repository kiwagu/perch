// scenario: user/base/resend-same-answer
import type { Page } from '@playwright/test'

import { generate } from '../../support/data'
import { checkYourMail, expect, signUp, test } from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'

/**
 * What the page shows once a resend went through: the message, no error, still on the page. The
 * gateway answers a resend at once and does not await its send, and a mail that would come comes
 * within a second on the stand: after two seconds the answer is on the page, the button is enabled
 * again, and the mailbox holds every mail the resend made go out.
 */
async function expectResent(page: Page): Promise<void> {
  await page.waitForTimeout(2_000)
  await expect(page.getByTestId('user.verify-email.resend-button')).toBeEnabled()
  await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
    'data-code',
    'check-your-mail',
  )
  await expect(page.getByTestId('user.verify-email.error')).toHaveCount(0)
  await expect(page).toHaveURL(/\/verify-email(\?.*)?$/)
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
      await page.getByTestId('user.verify-email.resend-button').click()
      // Expected: After step 4 [user.verify-email.message] carries [code:check-your-mail], no
      //   [user.verify-email.error] shows, and [mail:resend-verification] reaches the other email
      await expect(page.getByTestId('user.verify-email.message')).toHaveAttribute(
        'data-code',
        'check-your-mail',
      )
      await expect(page.getByTestId('user.verify-email.error')).toHaveCount(0)
      // The other email's first mail is its sign-up's; the resend's comes after it, in the
      // language the account signed up in.
      expectDeclaredMail(await mailbox.next(data.otherEmail, 1), 'resend-verification', {
        params: { email: data.otherEmail },
        account: { email: data.otherEmail, language: 'en' },
      })
    })

    await test.step('5. Enter the unknown email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.unknownEmail)
      await page.getByTestId('user.verify-email.resend-button').click()
      // Expected: After step 5 and after step 6 the page shows what it showed after step 4:
      //   [user.verify-email.message] carries [code:check-your-mail], no
      //   [user.verify-email.error] shows, and the URL stays [/verify-email]
      await expectResent(page)
    })

    await test.step('6. Enter the email into [user.verify-email.email-input] and click [user.verify-email.resend-button]', async () => {
      await page.getByTestId('user.verify-email.email-input').fill(data.email)
      await page.getByTestId('user.verify-email.resend-button').click()
      await expectResent(page)
    })

    // Expected:
    // - No [mail:resend-verification] reaches the unknown email or the email: the unknown email
    //   has none, and the email only the mail of its sign-up
    expect(await mailbox.count(data.unknownEmail), 'the mails to the unknown email').toBe(0)
    expect(await mailbox.count(data.email), 'the mails to the email').toBe(1)
  })
})
