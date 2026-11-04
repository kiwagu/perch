// scenario: user/base/delete-link-used
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import { expect, expectPathname, signUp, test } from '../../support/fixtures'
import { openMailLink } from '../../support/mail-contract'

test.describe('Open an account deletion link a second time', { tag: '@full' }, () => {
  test('A deletion link deletes once; opened again it says the link does not work, and offers no button', async ({
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
      await askToDeleteAccount(page, data.password)
    })

    const mail =
      await test.step('3. Open the link of [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
        // The email's second mail, after the sign-up's.
        const opened = await openDeletionMail(page, data.email, 1)

        await deleteAccount(page)
        // Expected: After step 3 [user.delete-account.message] carries [code:account-deleted]
        await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })

        return opened
      })

    await test.step('4. Open the same link again, click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await openMailLink(page, mail, 'request-account-deletion')
      await expectPathname(page, '/delete-account')
      await deleteAccount(page)
      // Expected: After step 4 [user.delete-account.error] carries [code:link-invalid] and no
      //   [user.delete-account.delete-button] shows
      await expect(page.getByTestId('user.delete-account.error')).toHaveAttribute(
        'data-code',
        'link-invalid',
      )
      await expect(page.getByTestId('user.delete-account.delete-button')).toHaveCount(0)
      await expect(page.getByTestId('user.delete-account.message')).toHaveCount(0)
    })
  })
})
