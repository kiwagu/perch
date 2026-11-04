// scenario: user/base/delete-account
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import {
  checkYourMail,
  expect,
  expectPathname,
  signUp,
  startSignUp,
  test,
} from '../../support/fixtures'
import { expectDeclaredMail } from '../../support/mail-contract'
import { mailbox } from '../../support/mailbox'
import { nextDeclaredNotice } from '../../support/notice-contract'

test.describe('Delete the account', { tag: '@smoke' }, () => {
  test("The account goes once the button of the page the mail's link opens is pressed; the old password no longer signs in, and the email signs up again", async ({
    page,
  }) => {
    // The deletion signs this device out, which waits for the sync channel first.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. Sign up with the email, the password and the name, open the link of [mail:sign-up], and click [app-shell.nav.settings-link]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.settings-link').click()
      await expect(page.getByTestId('user.settings.heading')).toBeVisible()
    })

    await test.step('2. Enter the password into [user.settings.deletion.password-input] and click [user.settings.deletion.send-button]', async () => {
      // Expected: After step 2 [user.settings.deletion.message] carries [code:check-your-mail],
      //   [user.settings.deletion.password-input] is empty, and [mail:request-account-deletion]
      //   reaches the email (step 3 waits for it)
      await askToDeleteAccount(page, data.password)
      await expect(page.getByTestId('user.settings.deletion.password-input')).toHaveValue('')
      await expect(page.getByTestId('user.settings.deletion.error')).toHaveCount(0)
    })

    await test.step('3. Open the link of [mail:request-account-deletion]', async () => {
      // The email's second mail, after the sign-up's.
      await openDeletionMail(page, data.email, 1)
      // Expected: After step 3 the link opens [/delete-account] with
      //   [user.delete-account.delete-button]
      await expectPathname(page, '/delete-account')
      await expect(page.getByTestId('user.delete-account.delete-button')).toBeVisible()
      await expect(page.getByTestId('user.delete-account.delete-button')).toBeEnabled()
    })

    await test.step('4. Click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      // Expected: At step 4 [app-shell.confirmation] carries [code:delete-account]
      await deleteAccount(page)
      // Expected: after it [user.delete-account.message] carries [code:account-deleted],
      //   [user.delete-account.sign-in-link] shows, and [notice:delete-account.account-deleted]
      //   reaches the email
      await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('user.delete-account.sign-in-link')).toBeVisible({
        timeout: 10_000,
      })
      await expectPathname(page, '/delete-account')
      // The email's third mail, after the sign-up's and the deletion mail, in the account's
      // language.
      await nextDeclaredNotice(
        'delete-account.account-deleted',
        { params: {}, account: { email: data.email, language: 'en' } },
        2,
      )
    })

    await test.step('5. Click [user.delete-account.sign-in-link], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], and click [user.sign-in.submit-button]', async () => {
      await page.getByTestId('user.delete-account.sign-in-link').click()
      await expectPathname(page, '/sign-in')
      await page.getByTestId('user.sign-in.email-input').fill(data.email)
      await page.getByTestId('user.sign-in.password-input').fill(data.password)
      await page.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 5 [user.sign-in.error] carries [code:invalid-credentials]
      await expect(page.getByTestId('user.sign-in.error')).toHaveAttribute(
        'data-code',
        'invalid-credentials',
      )
      await expectPathname(page, '/sign-in')
    })

    await test.step('6. Sign up with the email, the password and the name', async () => {
      await startSignUp(page, data)
      // Expected: After step 6 [user.sign-in.mail-message] carries [code:check-your-mail] and
      //   [mail:sign-up] reaches the email
      await expect(checkYourMail(page)).toBeVisible()
      // The email's fourth mail: a new sign-up's, after the notice.
      expectDeclaredMail(await mailbox.next(data.email, 3), 'sign-up', {
        params: { email: data.email, locale: 'en' },
      })
    })
  })
})
