// scenario: user/flows/signed-out-with-unsent-changes
import { generate } from '../../support/data'
import { appReady, expect, signIn, signInNotice, test, toast } from '../../support/fixtures'
import { SyncNetwork } from '../../support/network'
import { databases, identityDatabase } from '../../support/storage'

/**
 * How long a device back online may take to connect again: its reconnects back off up to
 * 30 seconds, and the gateway's refusal of its signed-out session follows.
 */
const RECONNECT_MS = 35_000

test.describe('Sign a device out from another one while it holds changes not sent yet', {
  tag: '@full',
}, () => {
  test('A device signed out from another one keeps the changes it had not sent, and signing in again as the same account sends them', async ({
    page,
    signedIn,
    secondDevice,
  }) => {
    // Coming back online may wait out a reconnect delay of up to 30 seconds.
    test.slow()

    const data = { unsentName: generate.newName() }
    // Device A's sync socket goes through the test from its next load, so step 3 can drop it.
    const network = await SyncNetwork.attach(page)

    const database =
      await test.step('1. On device A, sign up with the email, the password and the name, open the link of [mail:sign-up] and wait for [/me]', async () => {
        // The `signedIn` fixture has signed device A up through the sign-in page and its mail;
        // the page loads again, its sync socket now routed through the test.
        await page.goto('/me')
        await appReady(page)
        await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        const name = await identityDatabase(page)

        await expect.poll(() => databases(page)).toContain(name)

        return name
      })

    const deviceB =
      await test.step('2. On device B, sign in with the same account and open [/devices]', async () => {
        const b = await secondDevice.signIn()

        await b.getByTestId('app-shell.nav.devices-link').click()
        await expect(b).toHaveURL(/\/devices$/)

        return b
      })

    await test.step("3. Take device A's browser offline, enter the unsent name into [user.profile.name-input] and click [user.profile.save-button]", async () => {
      await network.goOffline()
      await page.getByTestId('user.profile.name-input').fill(data.unsentName)
      await page.getByTestId('user.profile.save-button').click()
      // Expected: After step 3 device A shows [app-shell.toast] carrying [code:profile-saved] and
      //   the unsent name, and its sync channel is down
      await expect(toast(page, 'profile-saved')).toBeVisible()
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.unsentName)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'down')
    })

    await test.step("4. On device B, click [device.list.revoke-button] on device A's [device.list.session-item] and confirm with [app-shell.confirmation.confirm-button]", async () => {
      // Device A's row on device B: the one not in the state `current`.
      const deviceARow = deviceB.locator(
        '[data-testid="device.list.session-item"]:not([data-state="current"])',
      )

      await expect(deviceARow).toHaveCount(1)
      await deviceARow.getByTestId('device.list.revoke-button').click()
      await deviceB.getByTestId('app-shell.confirmation.confirm-button').click()
      // Expected: After step 4 device A's [device.list.session-item] on device B is in
      //   [state:revoked]
      await expect(deviceARow).toHaveAttribute('data-state', 'revoked')
    })

    await test.step('5. On device B, open [/me]', async () => {
      await deviceB.getByTestId('app-shell.nav.profile-link').click()
      await expect(deviceB).toHaveURL(/\/me$/)
      // Expected: After step 5 device B shows the name, not the unsent name: the change has not
      //   reached the server
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(signedIn.name)
    })

    await test.step("6. Bring device A's browser back online", async () => {
      await network.goOnline()
      // Expected: After step 6 device A is on [/sign-in], where [user.sign-in.notice-message]
      //   carries [code:resend-after-sign-in], and its browser keeps the local database of the
      //   account
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: RECONNECT_MS })
      await expect(signInNotice(page, 'resend-after-sign-in')).toBeVisible()
      expect(await databases(page), "device A's database of the account").toContain(database)
    })

    await test.step('7. On device A, sign in again with the same account and wait for [/me]', async () => {
      await signIn(page, signedIn)
      // Expected: After step 7 device A shows the unsent name, and within 5 seconds device B shows
      //   it too: signing in again sent the change device A kept
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.unsentName, {
        timeout: 10_000,
      })
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.unsentName, {
        timeout: 5_000,
      })
    })
  })
})
