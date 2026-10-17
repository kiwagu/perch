// spec: tests/e2e/specs/sync/04-sign-out.md
import { generate } from '../support/data'
import { appReady, expect, signIn, test } from '../support/fixtures'
import { SyncNetwork } from '../support/network'
import { databases, identityDatabase } from '../support/storage'

test.describe('Sign out of one device', { tag: '@full' }, () => {
  test("Signing out deletes the device's data and leaves the other device signed in, and asks first while changes are unsent", async ({
    page,
    signedIn,
    secondDevice,
  }) => {
    // A sign-out waits for the sync channel first: several seconds when the device is offline.
    test.slow()

    const data = {
      bio: generate.bio(),
      newName: generate.newName(),
      unsentName: generate.newName(),
    }
    // Device A's sync socket goes through the test from the start, so step 6 can drop it.
    const network = await SyncNetwork.attach(page)

    const database =
      await test.step('1. On device A, open "/me", enter the bio and click "Save"', async () => {
        await page.goto('/me')
        await appReady(page)
        await page.getByTestId('user.profile.bio-input').fill(data.bio)
        await page.getByTestId('user.profile.save').click()
        await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')

        const name = await identityDatabase(page)

        await expect.poll(() => databases(page)).toContain(name)

        return name
      })

    const deviceB =
      await test.step('2. On device B, sign in with the same account and wait for "/me"', async () => {
        const b = await secondDevice.signIn()

        await expect(b.getByTestId('user.profile.bio-input')).toHaveValue(data.bio, {
          timeout: 10_000,
        })

        return b
      })

    await test.step('3. On device A, click "Sign out"', async () => {
      await page.getByTestId('user.profile.sign-out').click()
      // Expected: after step 3 device A is on "/sign-in" and its browser keeps no local
      // database of the account
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
      await expect.poll(() => databases(page), { timeout: 10_000 }).not.toContain(database)
    })

    await test.step('4. On device B, enter the new name and click "Save"', async () => {
      await deviceB.getByTestId('user.profile.name-input').fill(data.newName)
      await deviceB.getByTestId('user.profile.save').click()
      // Expected: after step 4 device B, still signed in, shows the notification "Saved"
      await expect(deviceB).toHaveURL(/\/me$/)
      await expect(deviceB.getByTestId('user.profile.notice')).toHaveText('Saved')
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.newName)
    })

    await test.step('5. On device A, sign in again with the same account and wait for "/me"', async () => {
      await signIn(page, signedIn)
      // Expected: after step 5 device A shows the profile the server holds: the new name from
      // device B and the bio from step 1
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName, {
        timeout: 10_000,
      })
      await expect(page.getByTestId('user.profile.bio-input')).toHaveValue(data.bio)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
    })

    await test.step('6. Take device A offline, enter the unsent name and click "Save"', async () => {
      await network.goOffline()
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'down')
      await page.getByTestId('user.profile.name-input').fill(data.unsentName)
      await page.getByTestId('user.profile.save').click()
      await expect(page.getByTestId('user.profile.notice')).toHaveText('Saved')
    })

    await test.step('7. On device A, click "Sign out"', async () => {
      await page.getByTestId('user.profile.sign-out').click()
      // Expected: after step 7 device A asks before deleting the change it could not send (the
      // app first waits a few seconds for the channel)
      await expect(page.getByTestId('user.profile.sign-out-offline.confirm')).toBeVisible({
        timeout: 15_000,
      })
    })

    await test.step('8. Click "Stay signed in"', async () => {
      await page.getByTestId('user.profile.sign-out-offline.cancel').click()
    })

    // Expected:
    // - After step 8 device A stays on "/me" with the unsent name, and its local database is kept
    await expect(page.getByTestId('user.profile.sign-out-offline.confirm')).toBeHidden()
    await expect(page).toHaveURL(/\/me$/)
    await expect(page.getByTestId('user.profile.heading')).toHaveText(data.unsentName)
    expect(await databases(page)).toContain(database)
  })
})
