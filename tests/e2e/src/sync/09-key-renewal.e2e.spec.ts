// spec: tests/e2e/specs/sync/09-key-renewal.md
import type { Page } from '@playwright/test'

import { appReady, expect, signUp, test } from '../support/fixtures'
import { keepAccessToken, keysKept } from '../support/storage'

/** The sync sockets a tab opened, and the types of the messages each way on them, in order. */
interface SyncTraffic {
  sockets: number
  readonly sent: string[]
  readonly received: string[]
}

/** The type of a protocol message on the sync socket. */
function typeOf(payload: string | Buffer): string {
  const message: unknown = JSON.parse(payload.toString())

  return typeof message === 'object' && message !== null && 'type' in message
    ? String(message.type)
    : ''
}

/** Watches the sync sockets `page` opens from now on. */
function syncTraffic(page: Page): SyncTraffic {
  const traffic: SyncTraffic = { sockets: 0, sent: [], received: [] }

  page.on('websocket', (socket) => {
    if (socket.url().endsWith('/backend/sync')) {
      traffic.sockets += 1
      socket.on('framesent', ({ payload }) => traffic.sent.push(typeOf(payload)))
      socket.on('framereceived', ({ payload }) => traffic.received.push(typeOf(payload)))
    }
  })

  return traffic
}

const counted = (types: readonly string[], type: string): number =>
  types.filter((each) => each === type).length

/** Whether each tab leads the sync of its browser, as `<html data-sync-leader>` says. */
const leading = (tabs: readonly Page[]): Promise<Array<string | null>> =>
  Promise.all(tabs.map((tab) => tab.locator('html').getAttribute('data-sync-leader')))

/** Opens "/devices" from the shell and expects it to list this device alone, within 5 seconds. */
async function expectDevicesListed(tab: Page): Promise<void> {
  await tab.getByTestId('app-shell.nav.devices').click()
  await expect(tab).toHaveURL(/\/devices$/)

  const devices = tab.getByTestId('device.list.item')

  await expect(devices).toHaveCount(1, { timeout: 5_000 })
  await expect(devices.getByTestId('device.list.current')).toHaveText('This device')
}

test.describe("Renew the device's keys over its open sync channel", { tag: '@full' }, () => {
  test('A route that refuses the access token has the tab that leads the sync renew the keys over its open channel, and the route answers with the new ones', async ({
    page,
  }) => {
    const data = {
      refusedAccessToken: 'refused',
    }
    // Watched before the sign-up opens the first tab's sync socket.
    const first = syncTraffic(page)

    await test.step('1. Sign up and wait for "/me" with the sync channel up', async () => {
      await signUp(page)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      // Expected: after step 1 the first tab leads the sync over one sync socket
      await expect(page.locator('html')).toHaveAttribute('data-sync-leader', '1')
      expect(first.sockets, 'sync sockets of the first tab').toBe(1)
      expect(counted(first.sent, 'renew'), '"renew" sent before any refusal').toBe(0)
    })

    const signedUpKeys =
      await test.step('2. In the browser\'s local storage, replace the value of "perch.session.token" with the refused access token', async () => {
        const kept = await keysKept(page)

        await keepAccessToken(page, data.refusedAccessToken)

        return kept
      })

    const renewedKeys = await test.step('3. Open "/devices"', async () => {
      // Expected: within 5 seconds of step 3 "/devices" lists one device, marked "This device",
      // and the browser keeps a new access token and a new refresh key; the first tab asked for
      // them with one "renew" on its sync socket and got them as "tokens", and opened no other
      // sync socket
      await expectDevicesListed(page)

      const kept = await keysKept(page)

      expect(kept.access, 'the access token kept').not.toBe(data.refusedAccessToken)
      expect(kept.access, 'the access token kept').not.toBe(signedUpKeys.access)
      expect(kept.refresh, 'the refresh key kept').not.toBe(signedUpKeys.refresh)
      expect(counted(first.sent, 'renew'), '"renew" sent by the first tab').toBe(1)
      expect(counted(first.received, 'tokens'), '"tokens" heard by the first tab').toBe(1)
      expect(first.sockets, 'sync sockets of the first tab').toBe(1)

      return kept
    })

    const { second, secondTraffic } =
      await test.step('4. Open "/me" in a second tab of the same browser and wait for the app to be ready', async () => {
        const tab = await page.context().newPage()
        const traffic = syncTraffic(tab)

        await tab.goto('/me')
        await appReady(tab)
        await expect(tab.getByTestId('user.profile.heading')).toBeVisible()
        // Expected: after step 4 the first tab still leads the sync and the second tab holds no
        // sync socket
        await expect.poll(() => leading([page, tab]), { timeout: 10_000 }).toEqual(['1', '0'])
        await expect(tab.locator('html')).toHaveAttribute('data-sync-channel', 'down')
        expect(traffic.sockets, 'sync sockets of the second tab').toBe(0)

        return { second: tab, secondTraffic: traffic }
      })

    await test.step('5. In the browser\'s local storage, replace the value of "perch.session.token" with the refused access token again', async () => {
      await keepAccessToken(second, data.refusedAccessToken)
    })

    await test.step('6. In the second tab, open "/devices"', async () => {
      // Expected: within 5 seconds of step 6 the second tab lists one device, marked "This
      // device", and the browser keeps another new pair of keys; the first tab asked for it with
      // a second "renew" on the same sync socket, and neither tab opened another sync socket
      await expectDevicesListed(second)

      const kept = await keysKept(second)

      expect(kept.access, 'the access token kept').not.toBe(data.refusedAccessToken)
      expect(kept.access, 'the access token kept').not.toBe(renewedKeys.access)
      expect(kept.refresh, 'the refresh key kept').not.toBe(renewedKeys.refresh)
      expect(counted(first.sent, 'renew'), '"renew" sent by the first tab').toBe(2)
      expect(counted(first.received, 'tokens'), '"tokens" heard by the first tab').toBe(2)
      expect(first.sockets, 'sync sockets of the first tab').toBe(1)
      expect(secondTraffic.sockets, 'sync sockets of the second tab').toBe(0)
    })
  })
})
