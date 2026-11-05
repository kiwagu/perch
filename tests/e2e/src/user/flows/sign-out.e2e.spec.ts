// scenario: user/flows/sign-out
import { generate } from '../../support/data'
import { appReady, expect, notice, signIn, test, toast } from '../../support/fixtures'
import { SyncNetwork } from '../../support/network'
import { databases, identityDatabase } from '../../support/storage'

test.describe('Sign out of one device', { tag: '@full' }, () => {
  test("Signing out deletes the device's data and leaves the other device signed in, and asks first while changes are unsent", async ({
    page,
    signedIn,
    secondDevice,
  }) => {
    const data = {
      bio: generate.bio(),
      newName: generate.newName(),
      unsentName: generate.newName(),
    }
    // Device A's sync socket goes through the test from the start, so step 6 can drop it.
    const network = await SyncNetwork.attach(page)

    const database =
      await test.step('1. On device A, open [/me], enter the bio into [user.profile.bio-textarea] and click [user.profile.save-button]', async () => {
        await page.goto('/me')
        await appReady(page)
        await page.getByTestId('user.profile.bio-textarea').fill(data.bio)
        await page.getByTestId('user.profile.save-button').click()
        await expect(toast(page, 'profile-saved')).toBeVisible()

        const name = await identityDatabase(page)

        await expect.poll(() => databases(page)).toContain(name)

        return name
      })

    const deviceB =
      await test.step('2. On device B, sign in with the same account and wait for [/me]', async () => {
        const b = await secondDevice.signIn()

        await expect(b.getByTestId('user.profile.bio-textarea')).toHaveValue(data.bio, {
          timeout: 10_000,
        })

        return b
      })

    await test.step('3. On device A, click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      // Expected: After step 3 device A is on [/sign-in], and its browser keeps no local database of
      //   the account
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
      await expect.poll(() => databases(page), { timeout: 10_000 }).not.toContain(database)
    })

    await test.step('4. On device B, enter the new name into [user.profile.name-input] and click [user.profile.save-button]', async () => {
      await deviceB.getByTestId('user.profile.name-input').fill(data.newName)
      await deviceB.getByTestId('user.profile.save-button').click()
      // Expected: After step 4 device B, still signed in, shows [app-shell.toast] carrying
      //   [code:profile-saved]
      await expect(deviceB).toHaveURL(/\/me$/)
      await expect(toast(deviceB, 'profile-saved')).toBeVisible()
      await expect(deviceB.getByTestId('user.profile.heading')).toHaveText(data.newName)
    })

    await test.step('5. On device A, sign in again with the same account and wait for [/me]', async () => {
      await signIn(page, signedIn)
      // Expected: After step 5 device A shows the profile the server holds: the new name from
      //   device B and the bio from step 1, and [app-shell.notice-message] carries [code:welcome]
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.newName, {
        timeout: 10_000,
      })
      await expect(page.getByTestId('user.profile.bio-textarea')).toHaveValue(data.bio)
      await expect(notice(page, 'welcome')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
    })

    await test.step("6. Take device A's browser offline, enter the unsent name into [user.profile.name-input] and click [user.profile.save-button]", async () => {
      await network.goOffline()
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'down')
      await page.getByTestId('user.profile.name-input').fill(data.unsentName)
      await page.getByTestId('user.profile.save-button').click()
      await expect(toast(page, 'profile-saved')).toBeVisible()
    })

    await test.step('7. On device A, click [user.profile.sign-out-button]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      // Expected: After step 7 device A asks at once, without waiting for the sync channel, before
      //   deleting the change it could not send: [user.profile.sign-out-dialog] carries
      //   [code:unsent-changes]
      // A sign-out that waited for the channel would ask only after 5 seconds.
      await expect(page.getByTestId('user.profile.sign-out-dialog')).toHaveAttribute(
        'data-code',
        'unsent-changes',
        { timeout: 3_000 },
      )
      await expect(page.getByTestId('user.profile.sign-out-dialog.confirm-button')).toBeVisible()
    })

    await test.step('8. Click [user.profile.sign-out-dialog.cancel-button]', async () => {
      await page.getByTestId('user.profile.sign-out-dialog.cancel-button').click()
      // Expected: After step 8 device A stays on [/me] with the unsent name, and its local database
      //   is kept
      await expect(page.getByTestId('user.profile.sign-out-dialog.confirm-button')).toBeHidden()
      await expect(page).toHaveURL(/\/me$/)
      await expect(page.getByTestId('user.profile.heading')).toHaveText(data.unsentName)
      expect(await databases(page)).toContain(database)
    })

    await test.step('9. On device A, click [user.profile.sign-out-button] and click [user.profile.sign-out-dialog.confirm-button]', async () => {
      await page.getByTestId('user.profile.sign-out-button').click()
      // The notice of step 5 still stands while the dialog asks, so only the sign-out takes it.
      await expect(page.getByTestId('user.profile.sign-out-dialog')).toBeVisible()
      await expect(notice(page, 'welcome')).toBeVisible()
      await page.getByTestId('user.profile.sign-out-dialog.confirm-button').click()
      // Expected: After step 9 device A is on [/sign-in] and shows no [app-shell.notice-message]:
      //   the notice of step 5 went with the account
      await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 })
      await expect(page.getByTestId('app-shell.notice-message')).toHaveCount(0)
    })
  })
})
