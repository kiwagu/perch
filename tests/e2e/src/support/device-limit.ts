/**
 * An account at its limit of devices, and what a sign-in past it shows. The gateway keeps an
 * account signed in on ten devices at once, so a test signs device A up and devices C to K in, in
 * turn, before device B signs in past the limit. The devices page lists the devices the earliest
 * signed in first: device A, then C to K, then B.
 */

import type { Locator, Page } from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { appReady, expect, type FreshDevices, signIn, syncSays } from './fixtures'
import { SyncNetwork } from './network'

/** Devices C to K: with device A, the ten devices an account may be signed in on at once. */
const DEVICES_C_TO_K = 9

/** Device C, the first of devices C to K, and its network, which the test may take offline. */
export interface DeviceC {
  readonly page: Page
  readonly network: SyncNetwork
}

/**
 * Signs `account` in on devices C to K in turn, each through the sign-in page and synced on `/me`
 * before the next, so that, with device A, the account is signed in on ten devices. Device C's
 * sync socket goes through the test from the start, so the test can take it offline.
 */
export async function signInDevicesCToK(
  devices: FreshDevices,
  account: SeedAccount,
): Promise<DeviceC> {
  const page = await devices.open()
  const network = await SyncNetwork.attach(page)

  await signIn(page, account)
  await syncSays(page)

  for (let signedIn = 1; signedIn < DEVICES_C_TO_K; signedIn += 1) {
    const device = await devices.open()

    await signIn(device, account)
    await syncSays(device)
  }

  return { page, network }
}

/** Opens the sign-in page and submits `account`, without waiting for what it answers. */
export async function submitSignIn(page: Page, account: SeedAccount): Promise<void> {
  await page.goto('/sign-in')
  await appReady(page)
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.submit-button').click()
}

/** The dialog a sign-in past the limit of devices asks in, by its anchor and its code. */
export const deviceLimitDialog = (page: Page): Locator =>
  page.locator('[data-testid="user.sign-in.device-limit-dialog"][data-code="device-limit"]')

/**
 * Holds device B's list of devices once its sign-in past the limit went through: eleven items,
 * device A's first, then C's to K's, then B's in `current`; device C's alone is in `revoked`, and
 * device A's and the eight others' are in neither state.
 */
export async function expectDeviceCSignedOut(page: Page): Promise<void> {
  const items = page.getByTestId('device.list').getByTestId('device.list.session-item')

  await expect(items).toHaveCount(11)
  await expect(items.nth(10)).toHaveAttribute('data-state', 'current')
  await expect(items.nth(1)).toHaveAttribute('data-state', 'revoked')
  await expect(
    page.locator('[data-testid="device.list.session-item"]:not([data-state])'),
  ).toHaveCount(9)
}
