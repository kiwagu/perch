// scenario: user/flows/key-renewal
import type { Page, Response } from '@playwright/test'

import { appReady, expect, signUp, test } from '../../support/fixtures'
import { keepAccessToken, keysKept } from '../../support/storage'

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

/**
 * Opens "/devices" from the shell and expects it to list this device alone within 5 seconds, its
 * list of devices asked of the gateway twice: refused (401) with the access token kept, then
 * answered (200) with the renewed one.
 */
async function expectDevicesListed(tab: Page): Promise<void> {
  const answers: number[] = []
  const listen = (response: Response) => {
    if (response.request().method() === 'GET' && response.url().endsWith('/backend/devices')) {
      answers.push(response.status())
    }
  }

  tab.on('response', listen)

  const started = Date.now()

  await tab.getByTestId('app-shell.nav.devices-link').click()
  await expect(tab).toHaveURL(/\/devices$/)

  const devices = tab.getByTestId('device.list').getByTestId('device.list.session-item')

  await expect(devices).toHaveCount(1, { timeout: 5_000 })
  await expect(devices).toHaveAttribute('data-state', 'current')
  expect(Date.now() - started, 'milliseconds from opening "/devices"').toBeLessThanOrEqual(5_000)
  expect(answers, 'the answers to the list of devices').toEqual([401, 200])
  tab.off('response', listen)
}

/**
 * Expects the first tab to have sent `renew` and heard `tokens` `times` times so far; polled,
 * since the test hears a socket's frames apart from the page.
 */
async function expectRenewals(traffic: SyncTraffic, times: number): Promise<void> {
  await expect
    .poll(() => [counted(traffic.sent, 'renew'), counted(traffic.received, 'tokens')], {
      message: '"renew" sent and "tokens" heard by the first tab',
    })
    .toEqual([times, times])
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

    await test.step('1. Sign up and wait for [/me] with the sync channel up', async () => {
      await signUp(page)
      await expect(page.locator('html')).toHaveAttribute('data-sync-channel', 'up', {
        timeout: 10_000,
      })
      // Expected: After step 1 the first tab leads the sync over one sync socket
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

    const renewedKeys = await test.step('3. Open [/devices]', async () => {
      // Expected: Within 5 seconds of step 3, on [/devices], [device.list] holds one
      //   [device.list.session-item], in [state:current] (this device), and the browser keeps a new
      //   access token and a new refresh key; the first tab asked for them with one "renew" on its
      //   sync socket and got them as "tokens", and opened no other sync socket
      await expectDevicesListed(page)

      const kept = await keysKept(page)

      expect(kept.access, 'the access token kept').not.toBe(data.refusedAccessToken)
      expect(kept.access, 'the access token kept').not.toBe(signedUpKeys.access)
      expect(kept.refresh, 'the refresh key kept').not.toBe(signedUpKeys.refresh)
      await expectRenewals(first, 1)
      expect(first.sockets, 'sync sockets of the first tab').toBe(1)

      return kept
    })

    const { second, secondTraffic } =
      await test.step('4. Open [/me] in a second tab of the same browser and wait for [app-shell.status] to reach [state:ready]', async () => {
        const tab = await page.context().newPage()
        const traffic = syncTraffic(tab)

        await tab.goto('/me')
        await appReady(tab)
        await expect(tab.getByTestId('user.profile.heading')).toBeVisible()
        // Expected: After step 4 the first tab still leads the sync and the second tab holds no
        //   sync socket
        await expect.poll(() => leading([page, tab]), { timeout: 10_000 }).toEqual(['1', '0'])
        await expect(tab.locator('html')).toHaveAttribute('data-sync-channel', 'down')
        expect(traffic.sockets, 'sync sockets of the second tab').toBe(0)

        return { second: tab, secondTraffic: traffic }
      })

    await test.step('5. In the browser\'s local storage, replace the value of "perch.session.token" with the refused access token again', async () => {
      await keepAccessToken(second, data.refusedAccessToken)
    })

    await test.step('6. In the second tab, open [/devices]', async () => {
      // Expected: Within 5 seconds of step 6 the second tab's [device.list] holds one
      //   [device.list.session-item], in [state:current] (this device), and the browser keeps
      //   another new pair of keys; the first tab asked for it with a second "renew" on the same
      //   sync socket, and neither tab opened another sync socket
      await expectDevicesListed(second)

      const kept = await keysKept(second)

      expect(kept.access, 'the access token kept').not.toBe(data.refusedAccessToken)
      expect(kept.access, 'the access token kept').not.toBe(renewedKeys.access)
      expect(kept.refresh, 'the refresh key kept').not.toBe(renewedKeys.refresh)
      await expectRenewals(first, 2)
      expect(first.sockets, 'sync sockets of the first tab').toBe(1)
      expect(secondTraffic.sockets, 'sync sockets of the second tab').toBe(0)
    })
  })
})
