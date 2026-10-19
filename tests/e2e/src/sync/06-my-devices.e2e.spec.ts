// spec: tests/e2e/specs/sync/06-my-devices.md
import type { Page } from '@playwright/test'

import { appReady, expect, signIn, test } from '../support/fixtures'
import { databases, identityDatabase } from '../support/storage'

const SIGNED_OUT_ELSEWHERE = 'You were signed out from another device.'

/**
 * "Last seen <when>" as the devices page writes it (the date and the minute, in the page's
 * language) for now and for a minute ago: a device seen within the last minute shows one of
 * the two.
 */
const seenWithinAMinute = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const format = new Intl.DateTimeFormat(document.documentElement.lang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    const now = Date.now()

    return [now, now - 60_000].map((time) => `Last seen ${format.format(time)}`)
  })

/** The device is signed out: on "/sign-in", and the shell offers nothing but signing in. */
async function expectSignedOut(device: Page): Promise<void> {
  await expect(device).toHaveURL(/\/sign-in$/)
  await expect(device.getByTestId('app-shell.nav.sign-in')).toBeVisible()
  await expect(device.getByTestId('app-shell.nav.devices')).toHaveCount(0)
}

test.describe('Sign a device out from another one, and everywhere', { tag: '@full' }, () => {
  test('A device signed out from another one leaves at once, signing out everywhere signs every device out, and the account signs in again after it', async ({
    page,
    signedIn,
    secondDevice,
  }) => {
    // Three sign-ins each wait for the sync channel to come up.
    test.slow()

    const devices = page.getByTestId('device.list.item')
    const current = page.getByTestId('device.list.current')
    // Device B's row on device A: the one not marked "This device".
    const deviceBRow = devices.filter({ hasNot: current })

    await test.step('1. On device A, sign up and open "/devices"', async () => {
      // The `signedIn` fixture has signed device A up through the sign-in page.
      await expect(page).toHaveURL(/\/me$/)
      await page.getByTestId('app-shell.nav.devices').click()
      await expect(page).toHaveURL(/\/devices$/)
      // Expected: after step 1 device A lists one device, marked "This device"
      await expect(devices).toHaveCount(1)
      await expect(devices.getByTestId('device.list.current')).toHaveText('This device')
      await expect(page.getByTestId('device.list.revoke')).toHaveCount(0)
    })

    const { deviceB, databaseOfB } =
      await test.step('2. On device B, sign in with the same account and wait for "/me"', async () => {
        const b = await secondDevice.signIn()

        // Device B hears that it was signed out over its sync channel.
        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        // Device B's database of the account, which a sign-out from device A must delete.
        const name = await identityDatabase(b)

        await expect.poll(() => databases(b)).toContain(name)

        return { deviceB: b, databaseOfB: name }
      })

    await test.step('3. On device A, reload "/devices"', async () => {
      await page.reload()
      await appReady(page)
      // Expected: after step 3 device A lists two devices: device B is not marked "This device"
      // and was last seen within the last minute
      await expect(devices).toHaveCount(2)
      await expect(current).toHaveCount(1)
      await expect(deviceBRow).toHaveCount(1)
      await expect(deviceBRow.getByTestId('device.list.revoke')).toBeVisible()

      const seen = await deviceBRow.getByTestId('device.list.seen').textContent()

      expect(await seenWithinAMinute(page), 'when device B was last seen').toContain(seen)
    })

    await test.step('4. On device A, click "Sign out" next to device B', async () => {
      await deviceBRow.getByTestId('device.list.revoke').click()
      // Expected: within 5 seconds of step 4 device B is on "/sign-in" with "You were signed out
      // from another device.", and its browser keeps no local database of the account; device A
      // lists device B as signed out
      await Promise.all([
        expect(deviceB).toHaveURL(/\/sign-in$/, { timeout: 5_000 }),
        expect(deviceB.getByTestId('user.sign-in.notice.signed-out-elsewhere')).toHaveText(
          SIGNED_OUT_ELSEWHERE,
          { timeout: 5_000 },
        ),
        expect
          .poll(() => databases(deviceB), {
            message: "device B's database of the account",
            timeout: 5_000,
          })
          .not.toContain(databaseOfB),
      ])
      await expect(devices).toHaveCount(2)
      await expect(deviceBRow.getByTestId('device.list.revoked')).toHaveText(/^Signed out /)
      await expect(deviceBRow.getByTestId('device.list.revoke')).toHaveCount(0)
    })

    await test.step('5. On device B, sign in again with the same account and wait for "/me"', async () => {
      await signIn(deviceB, signedIn)
      // Device B hears that every device was signed out over its sync channel.
      await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
    })

    await test.step('6. On device A, click "Sign out everywhere" and confirm with "Sign out everywhere"', async () => {
      await page.getByTestId('device.everywhere.open').click()
      await page.getByTestId('device.everywhere.confirm').click()
      // Expected: after step 6 device A is on "/sign-in" with "You were signed out from another
      // device."; within 5 seconds device B is on "/sign-in" with the same notice; a reload of
      // either stays on "/sign-in"
      await Promise.all(
        [page, deviceB].map(async (device) => {
          await expect(device).toHaveURL(/\/sign-in$/, { timeout: 5_000 })
          await expect(device.getByTestId('user.sign-in.notice.signed-out-elsewhere')).toHaveText(
            SIGNED_OUT_ELSEWHERE,
            { timeout: 5_000 },
          )
        }),
      )

      for (const device of [page, deviceB]) {
        await device.reload()
        await appReady(device)
        await expectSignedOut(device)
      }
    })

    await test.step('7. On device A, sign in again with the same account and wait for "/me"', async () => {
      await signIn(page, signedIn)
      // Expected: after step 7 device A is on "/me" and its sync channel is up: the account signs
      // in again after signing out everywhere
      await expect(page).toHaveURL(/\/me$/)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      await expect(page.getByTestId('user.profile.heading')).toHaveText(signedIn.name, {
        timeout: 10_000,
      })
    })
  })
})
