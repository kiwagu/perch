// scenario: user/flows/reset-signs-out-everywhere
import { generate } from '../../support/data'
import { expect, expectPathname, signInNotice, signUp, test } from '../../support/fixtures'
import { askForReset, enterNewPassword, openResetMail } from '../../support/password-reset'

test.describe('Set a new password while another device is signed in', { tag: '@full' }, () => {
  test('A new password set from the mail signs every device of the account out', async ({
    page,
    freshDevice,
  }) => {
    // A sign-up waits for the sync channel to come up.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
      // Device A hears that it was signed out over its sync channel.
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
    })

    const deviceB =
      await test.step('2. On device B, open [/forgot-password], enter the email into [user.forgot-password.email-input] and click [user.forgot-password.send-button]', async () => {
        const b = await freshDevice.open()

        await askForReset(b, data.email)

        return b
      })

    await test.step('3. On device B, open the link of [mail:request-password-reset], enter the new password into [user.reset-password.password-input] and [user.reset-password.password-confirmation-input], and click [user.reset-password.submit-button]', async () => {
      await openResetMail(deviceB, data.email, 1)
      await enterNewPassword(deviceB, data.newPassword)
      // Expected: After step 3 [user.reset-password.message] carries [code:password-reset] on
      //   device B
      await expect(deviceB.getByTestId('user.reset-password.message')).toHaveAttribute(
        'data-code',
        'password-reset',
      )
    })

    // Expected: Device A is signed out: its URL is [/sign-in] and [user.sign-in.notice-message]
    //   carries [code:password-changed-elsewhere]
    await expectPathname(page, '/sign-in', 10_000)
    await expect(signInNotice(page, 'password-changed-elsewhere')).toBeVisible()
    await expect(page.getByTestId('app-shell.nav')).toHaveCount(0)
  })
})
