// scenario: user/flows/password-changed-while-offline
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
import { SyncNetwork } from '../../support/network'

/**
 * How long a device back online may take to connect again: its reconnects back off up to
 * 30 seconds.
 */
const RECONNECT_MS = 35_000

test.describe('Change the password while another device is offline', { tag: '@full' }, () => {
  test('A device signed out by a change of the password while it was offline learns why when it connects again', async ({
    page,
    freshDevice,
  }) => {
    // A sign-in waits for the sync channel, and coming back online may wait out a reconnect delay
    // of up to 30 seconds.
    test.slow()

    const data = {
      ...generate.account(),
      name: generate.name(),
      newPassword: generate.newPassword(),
    }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
    })

    const { deviceB, network } =
      await test.step('2. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input], click [user.sign-in.submit-button] and wait for [/me]', async () => {
        const b = await freshDevice.open()
        // Device B's sync socket goes through the test from the start, so it can go offline.
        const network = await SyncNetwork.attach(b)

        await signIn(b, data)
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return { deviceB: b, network }
      })

    await test.step("3. Take device B's browser offline", async () => {
      await network.goOffline()
      await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'down')
    })

    await test.step('4. On device A, open [/settings], enter the password into [user.settings.password.current-password-input], the new password into [user.settings.password.new-password-input] and [user.settings.password.password-confirmation-input], and click [user.settings.password.save-button]', async () => {
      await page.goto('/settings')
      await appReady(page)
      await page.getByTestId('user.settings.password.current-password-input').fill(data.password)
      await page.getByTestId('user.settings.password.new-password-input').fill(data.newPassword)
      await page
        .getByTestId('user.settings.password.password-confirmation-input')
        .fill(data.newPassword)
      await page.getByTestId('user.settings.password.save-button').click()
      // Expected: After step 4 [app-shell.toast] carries [code:password-changed] on device A, and
      //   device B is still on [/me]
      await expect(toast(page, 'password-changed')).toBeVisible()
      await expectPathname(deviceB, '/me')
    })

    await test.step("5. Bring device B's browser back online", async () => {
      await network.goOnline()
      // Expected: After step 5 device B is on [/sign-in] once it connects again, where
      //   [user.sign-in.notice-message] carries [code:password-changed-elsewhere]
      await expectPathname(deviceB, '/sign-in', RECONNECT_MS)
      await expect(signInNotice(deviceB, 'password-changed-elsewhere')).toBeVisible()
    })
  })
})
