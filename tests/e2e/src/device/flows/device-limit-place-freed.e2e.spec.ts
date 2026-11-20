// scenario: device/flows/device-limit-place-freed
import { generate } from '../../support/data'
import {
  deviceLimitDialog,
  expectDeviceCSignedOut,
  signInDevicesCToK,
  submitSignIn,
} from '../../support/device-limit'
import { expect, expectPathname, signUp, test } from '../../support/fixtures'

test.describe('Confirm a sign-in past the device limit once a place freed', {
  tag: '@full',
}, () => {
  test("A sign-in confirmed after one of the account's devices was signed out meanwhile signs no other device out", async ({
    page,
    freshDevices,
  }) => {
    // Eleven devices sign in, each waiting for its sync channel: 18 s alone on the dev host, the
    // default budget is not enough when other runs load it.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
      await signUp(page, data)
    })

    await test.step('2. On devices C to K in turn, sign in with the same account and wait for [app-shell.sync-message] to carry [code:synced] on [/me], so the account is signed in on ten devices', async () => {
      await signInDevicesCToK(freshDevices, data)
    })

    const deviceB = await freshDevices.open()

    await test.step('3. On device B, open [/sign-in], enter the email and the password into [user.sign-in.email-input] and [user.sign-in.password-input] and click [user.sign-in.submit-button]', async () => {
      await submitSignIn(deviceB, data)
      // Expected: After step 3 [user.sign-in.device-limit-dialog] carries [code:device-limit]
      await expect(deviceLimitDialog(deviceB)).toBeVisible()
    })

    await test.step("4. On device A, open [/devices], click [device.list.revoke-button] on device C's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      // Through the navigation, not a reload: device A stays the device seen least recently.
      await page.getByTestId('app-shell.nav.devices-link').click()
      await expectPathname(page, '/devices')

      // The list goes by sign-in, the earliest first: device A's (this one), then device C's.
      const items = page.getByTestId('device.list').getByTestId('device.list.session-item')
      const deviceCItem = items.nth(1)

      await expect(items).toHaveCount(10)
      await expect(items.nth(0)).toHaveAttribute('data-state', 'current')
      await deviceCItem.getByTestId('device.list.revoke-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      await expect(deviceCItem).toHaveAttribute('data-state', 'revoked')
    })

    await test.step('5. On device B, click [user.sign-in.device-limit-dialog.confirm-button]', async () => {
      await deviceB.getByTestId('user.sign-in.device-limit-dialog.confirm-button').click()
      // Expected: After step 5 device B is on [/me]
      await expectPathname(deviceB, '/me')
    })

    await test.step('6. On device B, open [/devices]', async () => {
      await deviceB.getByTestId('app-shell.nav.devices-link').click()
      await expectPathname(deviceB, '/devices')
      // Expected: After step 6 [device.list] holds eleven [device.list.session-item]: device B's
      //   in [state:current], device C's in [state:revoked], and device A's, seen least recently,
      //   and the eight others in neither
      await expectDeviceCSignedOut(deviceB)
    })

    // Device A, seen least recently, is still signed in.
    await expect(page.getByTestId('app-shell.nav')).toBeVisible()
  })
})
