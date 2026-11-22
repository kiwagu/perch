/**
 * The second factor the tests share: turning it on from `/settings`, and the sign-in page's
 * password step and code dialog. The sign-in steps are written out by hand, since `signIn` of
 * the fixtures asserts `/me` and an account with the second factor on stops at the dialog.
 */

import type { Locator, Page } from '@playwright/test'

import type { SeedAccount } from '@workspace/seed/catalog'

import { expect, toast } from './fixtures'
import { totpFor } from './totp'

/** What turning the second factor on shows: the key to type and the backup codes, shown once. */
export interface SecondFactorOn {
  /** The key of the authenticator app, as the key cell shows it. */
  readonly key: string
  /** The ten backup codes the codes cell shows, in its order. */
  readonly codes: readonly string[]
}

/** The second-factor section of `/settings`, by its anchor. */
export const twoFactorSection = (page: Page): Locator =>
  page.getByTestId('user.settings.two-factor.section')

/** Waits until the second-factor section has read the factor, on or off. */
export async function expectTwoFactorRead(page: Page): Promise<void> {
  await expect(twoFactorSection(page)).toHaveAttribute('data-state', 'ready')
}

/** The backup codes the codes cell shows, one per line, in its order. */
export async function backupCodesShown(page: Page): Promise<readonly string[]> {
  const text = await page.getByTestId('user.settings.two-factor.codes-cell').innerText()

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * On `/settings` with the second factor off and read, enters `password`, starts turning it on,
 * enters the code the shown key gives now and confirms it; resolves once the toast says it is on,
 * the backup codes still shown: the test hides them.
 */
export async function turnSecondFactorOn(page: Page, password: string): Promise<SecondFactorOn> {
  const key = page.getByTestId('user.settings.two-factor.key-cell')

  await expectTwoFactorRead(page)
  await page.getByTestId('user.settings.two-factor.password-input').fill(password)
  await page.getByTestId('user.settings.two-factor.enable-button').click()
  await expect(key).toHaveText(/^[A-Z2-7]+$/)

  const shown = (await key.innerText()).trim()

  await page.getByTestId('user.settings.two-factor.code-input').fill(await totpFor(shown))
  await page.getByTestId('user.settings.two-factor.confirm-button').click()
  await expect(toast(page, 'two-factor-enabled')).toBeVisible()

  return { key: shown, codes: await backupCodesShown(page) }
}

/** Enters the email and the password of `account` into the sign-in form and submits it. */
export async function submitCredentials(page: Page, account: SeedAccount): Promise<void> {
  await page.getByTestId('user.sign-in.email-input').fill(account.email)
  await page.getByTestId('user.sign-in.password-input').fill(account.password)
  await page.getByTestId('user.sign-in.submit-button').click()
}

/**
 * The dialog that asks for a code once the password is right, by its anchor alone: a test that
 * expects it to show asserts the `code-required` it carries, and one that expects it gone asserts
 * the anchor is gone, never a dialog that only lost its code.
 */
export const codeDialog = (page: Page): Locator => page.getByTestId('user.sign-in.code.dialog')

/** Enters `code` into the code dialog and confirms it. */
export async function submitCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('user.sign-in.code.code-input').fill(code)
  await page.getByTestId('user.sign-in.code.dialog.confirm-button').click()
}
