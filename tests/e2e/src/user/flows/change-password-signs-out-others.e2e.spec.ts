// scenario: user/flows/change-password-signs-out-others
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  signIn,
  signInNotice,
  signUp,
  test,
  toast,
} from '../../support/fixtures'

test.describe('Change the password while another device is signed in', { tag: '@full' }, () => {
  test("A changed password signs the account's other devices out and keeps this one signed in", async ({
    page,
    freshDevice,
  }) => {
    // A sign-in waits for the sync channel to come up.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

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

    await test.step('3. On device A, open [/settings], enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await page.getByTestId('user.settings.password.current-password-input').fill(data.password)
      await page.getByTestId('user.settings.password.new-password-input').fill(data.newPassword)
      await page
        .getByTestId('user.settings.password.password-confirmation-input')
        .fill(data.newPassword)
      await page.getByTestId('user.settings.password.save-button').click()
      // Expected: After step 3 [app-shell.toast] carries [code:password-changed] on device A,
      //   which stays on [/settings]
      await expect(toast(page, 'password-changed')).toBeVisible()
      await expectPathname(page, '/settings')
    })

    // Expected: Device B is signed out: its URL is [/sign-in] and [user.sign-in.notice-message]
    //   carries [code:password-changed-elsewhere]
    await expectPathname(deviceB, '/sign-in', 10_000)
    await expect(signInNotice(deviceB, 'password-changed-elsewhere')).toBeVisible()
    await expect(deviceB.getByTestId('app-shell.nav')).toHaveCount(0)
    // Device A is still signed in.
    await expect(page.getByTestId('app-shell.nav')).toBeVisible()
  })
})
