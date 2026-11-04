// scenario: user/flows/delete-account-signs-out-others
import {
  accountDeleted,
  askToDeleteAccount,
  deleteAccount,
  openDeletionMail,
  openSettings,
} from '../../support/account-deletion'
import { generate } from '../../support/data'
import { expect, expectPathname, signIn, signInNotice, signUp, test } from '../../support/fixtures'

test.describe('Delete the account while another device is signed in', { tag: '@full' }, () => {
  test("The deletion signs the account's other devices out, and the device that deleted keeps the page's message", async ({
    page,
    freshDevice,
  }) => {
    // A sign-in waits for the sync channel to come up.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
    })

    const deviceB =
      await test.step('2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]', async () => {
        const b = await freshDevice.open()

        await signIn(b, data)
        // Device B hears that it was signed out over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return b
      })

    await test.step('3. On device A, open [/settings], enter the password into [user.settings.deletion.password-input], click [user.settings.deletion.send-button], open the link of [mail:request-account-deletion], click [user.delete-account.delete-button] and confirm with [app-shell.confirmation.confirm-button]', async () => {
      await openSettings(page)
      await askToDeleteAccount(page, data.password)
      // The email's second mail, after the sign-up's.
      await openDeletionMail(page, data.email, 1)
      await deleteAccount(page)
      // Expected: After step 3 [user.delete-account.message] carries [code:account-deleted] on
      //   device A, which stays on [/delete-account] and shows [user.delete-account.sign-in-link]
      await expect(accountDeleted(page)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('user.delete-account.sign-in-link')).toBeVisible({
        timeout: 10_000,
      })
      await expectPathname(page, '/delete-account')
    })

    // Expected: Device B is signed out: its URL is [/sign-in] and [user.sign-in.notice-message]
    //   carries [code:signed-out-elsewhere]
    await expectPathname(deviceB, '/sign-in', 10_000)
    await expect(signInNotice(deviceB, 'signed-out-elsewhere')).toBeVisible()
    await expect(deviceB.getByTestId('app-shell.nav')).toHaveCount(0)
    // Device A keeps the page's message, signed out too.
    await expect(accountDeleted(page)).toBeVisible()
    await expect(page.getByTestId('app-shell.nav')).toHaveCount(0)
  })
})
