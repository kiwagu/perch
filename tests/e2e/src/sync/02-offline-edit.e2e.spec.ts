// spec: tests/e2e/specs/sync/02-offline-edit.md
import { generate } from '../support/data'
import { appReady, expect, test } from '../support/fixtures'
import { SyncNetwork } from '../support/network'

/**
 * How long a device back online may take to connect again: its reconnects back off up to
 * 30 seconds, and the catch-up follows.
 */
const RECONNECT_MS = 35_000

test.describe('Edit offline and catch up when back online', { tag: '@full' }, () => {
  test('A bio written offline on one device and a name changed meanwhile on another reach both devices', async ({
    page,
    secondDevice,
  }) => {
    // Coming back online may wait out a reconnect delay of up to 30 seconds.
    test.slow()

    const data = {
      bio: generate.bio(),
      newName: generate.newName(),
    }

    await test.step('1. On device A, open "/me" and wait for the app to be ready', async () => {
      await page.goto('/me')
      await appReady(page)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
    })

    const { deviceB, network } =
      await test.step('2. On device B, sign in with the same account and wait for "/me"', async () => {
        // The sync socket is routed before device B opens the app, so the test can drop it.
        const network = await SyncNetwork.attach(await secondDevice.open())
        const b = await secondDevice.signIn()

        await expect(b.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
          timeout: 10_000,
        })

        return { deviceB: b, network }
      })

    await test.step('3. Take device B offline', async () => {
      await network.goOffline()
      // Expected: after step 3 the sync channel of device B is down
      await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'down')
    })

    await test.step('4. On device B, enter the bio and click "Save"', async () => {
      await deviceB.getByTestId('user.profile.bio-input').fill(data.bio)
      await deviceB.getByTestId('user.profile.save').click()
      // Expected: after step 4 device B shows the notification "Saved" and the bio, and its
      // sync channel is still down
      await expect(deviceB.getByTestId('user.profile.notice')).toHaveText('Saved')
      await expect(deviceB.getByTestId('user.profile.bio-input')).toHaveValue(data.bio)
      await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'down')
    })

    await test.step('5. On device A, enter the new name and click "Save"', async () => {
      await page.getByTestId('user.profile.name-input').fill(data.newName)
      await page.getByTestId('user.profile.save').click()
      // Expected: after step 5 device A shows the notification "Saved" and the new name
      await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName)
    })

    await test.step('6. Bring device B back online', async () => {
      await network.goOnline()
    })

    // Expected:
    // - After step 6 the sync channel of device B comes up again
    await expect(deviceB.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
      timeout: RECONNECT_MS,
    })
    // - Then both devices show the new name from device A and the bio from device B
    for (const device of [page, deviceB]) {
      await expect(device.getByTestId('user.profile.heading')).toHaveText(data.newName, {
        timeout: 10_000,
      })
      await expect(device.getByTestId('user.profile.bio-input')).toHaveValue(data.bio, {
        timeout: 10_000,
      })
    }
  })
})
