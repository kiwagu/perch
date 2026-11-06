// scenario: device/flows/device-limit
import { generate } from '../../support/data'
import {
  deviceLimitDialog,
  expectDeviceCSignedOut,
  signInDevicesCToK,
  submitSignIn,
} from '../../support/device-limit'
import {
  appReady,
  expect,
  expectPathname,
  signInNotice,
  signUp,
  syncSays,
  test,
} from '../../support/fixtures'

/**
 * How long a device back online may take to connect again: its reconnects back off up to
 * 30 seconds.
 */
const RECONNECT_MS = 35_000

test.describe('Sign in past the number of devices an account may be signed in on', {
  tag: '@full',
}, () => {
  test("A sign-in past the account's limit asks first and, once confirmed, signs out the device seen least recently rather than the one signed in first, which learns why when it connects again", async ({
    page,
    freshDevices,
  }) => {
    // Eleven devices sign in, each waiting for its sync channel, and device C may wait out a
    // reconnect delay of up to 30 seconds: 16 s alone on the dev host, the default budget is not
    // enough when other runs load it.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
    })

    const deviceC =
      await test.step('2. On devices C to K in turn, sign in with the same account and wait for [app-shell.sync-message] to carry [code:synced] on [/me], so the account is signed in on ten devices', async () =>
        signInDevicesCToK(freshDevices, data))

    await test.step('3. On device A, reload [/me] and wait for [app-shell.sync-message] to carry [code:synced]', async () => {
      // Device A is seen again: device C is now the device seen least recently.
      await page.reload()
      await appReady(page)
      await syncSays(page)
    })

    await test.step("4. Take device C's browser offline", async () => {
      await deviceC.network.goOffline()
      await expect(deviceC.page.locator('html')).toHaveAttribute('data-sync-channel', 'down')
    })

    const deviceB = await freshDevices.open()

    await test.step('5. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await submitSignIn(deviceB, data)
      // Expected: After step 5 [user.sign-in.device-limit-dialog] carries [code:device-limit],
      //   and device B is still on [/sign-in]: nothing is signed in yet
      await expect(deviceLimitDialog(deviceB)).toBeVisible()
      await expectPathname(deviceB, '/sign-in')
    })

    await test.step('6. Click [user.sign-in.device-limit-dialog.cancel-button]', async () => {
      await deviceB.getByTestId('user.sign-in.device-limit-dialog.cancel-button').click()
      // Expected: After step 6 [user.sign-in.device-limit-dialog] is gone and device B is still
      //   on [/sign-in]
      await expect(deviceB.getByTestId('user.sign-in.device-limit-dialog')).toHaveCount(0)
      await expectPathname(deviceB, '/sign-in')
    })

    await test.step('7. Click [user.sign-in.submit-button] again', async () => {
      await deviceB.getByTestId('user.sign-in.submit-button').click()
      // Expected: After step 7 [user.sign-in.device-limit-dialog] carries [code:device-limit]
      //   again
      await expect(deviceLimitDialog(deviceB)).toBeVisible()
    })

    await test.step('8. Click [user.sign-in.device-limit-dialog.confirm-button]', async () => {
      await deviceB.getByTestId('user.sign-in.device-limit-dialog.confirm-button').click()
      // Expected: After step 8 device B is on [/me]
      await expectPathname(deviceB, '/me')
    })

    await test.step('9. On device B, open [/devices]', async () => {
      await deviceB.getByTestId('app-shell.nav.devices-link').click()
      await expectPathname(deviceB, '/devices')
      // Expected: After step 9 [device.list] holds eleven [device.list.session-item]: device B's
      //   in [state:current], device C's in [state:revoked], and device A's and the eight others
      //   in neither
      await expectDeviceCSignedOut(deviceB)
    })

    await test.step("10. Bring device C's browser back online", async () => {
      await deviceC.network.goOnline()
      // Expected: After step 10 device C is on [/sign-in] once it connects again, where
      //   [user.sign-in.notice-message] carries [code:device-limit-elsewhere]
      await expectPathname(deviceC.page, '/sign-in', RECONNECT_MS)
      await expect(signInNotice(deviceC.page, 'device-limit-elsewhere')).toBeVisible()
    })

    // Device A, seen more recently than device C, is still signed in.
    await expect(page.getByTestId('app-shell.nav')).toBeVisible()
  })
})
