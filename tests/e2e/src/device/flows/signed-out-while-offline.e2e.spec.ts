// scenario: device/flows/signed-out-while-offline
import { generate } from '../../support/data'
import {
  appReady,
  expect,
  expectPathname,
  signIn,
  signInNotice,
  signUp,
  test,
} from '../../support/fixtures'
import { BACK_ONLINE_MS, SyncNetwork } from '../../support/network'

test.describe('Sign a device out while it is offline', { tag: '@full' }, () => {
  test('A device signed out from another one while it was offline learns why when it connects again', async ({
    page,
    freshDevice,
  }) => {
    // A sign-in waits for the sync channel, and device B stays offline until its reconnect delay
    // reaches 30 seconds.
    test.slow()

    const data = { ...generate.account(), name: generate.name() }
    // Device B's row on device A: the one not in the state `current`.
    const deviceBItem = page.locator(
      '[data-testid="device.list.session-item"]:not([data-state="current"])',
    )

    await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and open [/devices]', async () => {
      await signUp(page, data)
      await page.getByTestId('app-shell.nav.devices-link').click()
      await expectPathname(page, '/devices')
    })

    const { deviceB, network } =
      await test.step('2. On device B, sign in with the same account and wait for [/me]', async () => {
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
      // Offline until its reconnect delay reaches the capped step: every attempt after the fifth
      // draws a delay of up to 30 seconds, so a wait pending here can be long, and coming back
      // online in step 5 must not wait it out. A draw can also be short, so this step does not
      // prove the network-back wiring; that is checked deterministically in
      // apps/web/src/composition/sync-transport.spec.ts.
      await network.untilLongestReconnectDelay()
    })

    await test.step("4. On device A, reload [/devices], click [device.list.revoke-button] on device B's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      await page.reload()
      await appReady(page)
      await deviceBItem.getByTestId('device.list.revoke-button').click()
      await page.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 4 device B's [device.list.session-item] on device A is in
      //   [state:revoked], and device B is still on [/me]
      await expect(deviceBItem).toHaveAttribute('data-state', 'revoked')
      await expectPathname(deviceB, '/me')
    })

    await test.step("5. Bring device B's browser back online", async () => {
      await network.goOnline()
      // Expected: After step 5 device B is on [/sign-in] once it connects again, where
      //   [user.sign-in.notice-message] carries [code:signed-out-elsewhere]
      await expectPathname(deviceB, '/sign-in', BACK_ONLINE_MS)
      await expect(signInNotice(deviceB, 'signed-out-elsewhere')).toBeVisible()
    })
  })
})
