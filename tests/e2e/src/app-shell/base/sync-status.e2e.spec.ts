// scenario: app-shell/base/sync-status
import type { Page } from '@playwright/test'

import { generate } from '../../support/data'
import { appReady, expect, signUp, test, toast } from '../../support/fixtures'
import { SyncNetwork } from '../../support/network'

/**
 * How long a tab may take to connect again: its reconnects back off up to 30 seconds, and the
 * record the leading tab shares follows within two.
 */
const RECONNECT_MS = 35_000

/** The state of the sync a tab says, by the anchor and its code together. */
const syncSays = (page: Page, code: string, timeout = 15_000) =>
  expect(page.getByTestId('app-shell.sync-message')).toHaveAttribute('data-code', code, {
    timeout,
  })

test.describe("See the state of this device's sync in every tab", { tag: '@full' }, () => {
  test('Both tabs of a browser say the same state of its sync through a dropped connection, the network going and an edit made offline', async ({
    page,
  }) => {
    // Connecting again may wait out a reconnect delay of up to 30 seconds, twice.
    test.slow()

    const newName = generate.newName()
    // Each tab's sync socket is routed before it opens the app, so the test can drop it,
    // whichever tab leads.
    const networks = [await SyncNetwork.attach(page)]

    await test.step('1. Sign up and wait for [app-shell.status] to reach [state:ready] on [/me]', async () => {
      await signUp(page)
      await appReady(page)
      // Expected: After step 1 [app-shell.sync-message] carries [code:synced]
      await syncSays(page, 'synced')
    })

    const second =
      await test.step('2. Open [/me] in a second tab and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()

        networks.push(await SyncNetwork.attach(tab))
        await tab.goto('/me')
        await appReady(tab)
        // Expected: After step 2 [app-shell.sync-message] carries [code:synced] in both tabs
        await syncSays(tab, 'synced')
        await syncSays(page, 'synced')

        return tab
      })

    await test.step('3. Drop the sync connection while the browser keeps its network, and refuse a new one for now', async () => {
      for (const network of networks) {
        await network.dropChannel()
      }

      // Expected: After step 3 [app-shell.sync-message] carries [code:connecting] in both tabs
      await syncSays(page, 'connecting')
      await syncSays(second, 'connecting')
    })

    await test.step('4. Let the sync connect again', async () => {
      for (const network of networks) {
        network.restoreChannel()
      }

      // Expected: After step 4 [app-shell.sync-message] carries [code:synced] in both tabs
      await syncSays(page, 'synced', RECONNECT_MS)
      await syncSays(second, 'synced')
    })

    await test.step('5. Take the browser offline', async () => {
      for (const network of networks) {
        await network.goOffline()
      }

      // Expected: After step 5 [app-shell.sync-message] carries [code:offline] in both tabs
      await syncSays(page, 'offline')
      await syncSays(second, 'offline')
    })

    await test.step('6. In the second tab, enter the new name into [user.profile.name-input] and click [user.profile.save-button]', async () => {
      await second.getByTestId('user.profile.name-input').fill(newName)
      await second.getByTestId('user.profile.save-button').click()
      // Expected: After step 6 the second tab shows the new name, and [app-shell.sync-message]
      //   still carries [code:offline] in both tabs
      await expect(toast(second, 'profile-saved')).toBeVisible()
      await expect(second.getByTestId('user.profile.heading')).toHaveText(newName)
      await syncSays(second, 'offline')
      await syncSays(page, 'offline')
    })

    await test.step('7. Bring the browser back online', async () => {
      for (const network of networks) {
        await network.goOnline()
      }

      // Expected: After step 7 [app-shell.sync-message] carries [code:synced] in both tabs:
      //   the new name was sent
      await syncSays(page, 'synced', RECONNECT_MS)
      await syncSays(second, 'synced')
    })
  })
})
