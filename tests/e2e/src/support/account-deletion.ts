import type { Page } from '@playwright/test'

import type { Mail } from '@workspace/mailbox'

import { appReady, expect } from './fixtures'
import { openDeclaredMail } from './mail-contract'

/** The message of the settings' deletion form, once it asks to open the link of the mail. */
export const deletionRequested = (page: Page) =>
  page.locator('[data-testid="user.settings.deletion.message"][data-code="check-your-mail"]')

/** The message of /delete-account, once the account is gone. */
export const accountDeleted = (page: Page) =>
  page.locator('[data-testid="user.delete-account.message"][data-code="account-deleted"]')

/** Opens /settings and waits until the app is ready there. */
export async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings')
  await appReady(page)
  await expect(page.getByTestId('user.settings.deletion.form')).toBeVisible()
}

/**
 * On /settings, enters `password` into the deletion form and clicks its send button; resolves the
 * moment the test saw the gateway's answer to that request, waited for from before the click.
 */
export async function sendDeletionRequest(page: Page, password: string): Promise<number> {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/auth/request-account-deletion'),
    { timeout: 10_000 },
  )

  await page.getByTestId('user.settings.deletion.password-input').fill(password)
  await page.getByTestId('user.settings.deletion.send-button').click()
  await answered

  return Date.now()
}

/**
 * On /settings, asks with `password` to delete the account; waits until the form asks to open the
 * link of the mail sent to the account's email.
 */
export async function askToDeleteAccount(page: Page, password: string): Promise<void> {
  await sendDeletionRequest(page, password)
  await expect(deletionRequested(page)).toBeVisible()
}

/**
 * Waits for the deletion mail to the account at `email` after its first `seen` mails, in the
 * account's language (`en`, the browser's at its sign-up), holds it to its declaration and opens
 * its link in `page`.
 */
export const openDeletionMail = (page: Page, email: string, seen: number): Promise<Mail> =>
  openDeclaredMail(
    page,
    'request-account-deletion',
    { params: {}, account: { email, language: 'en' } },
    seen,
  )

/**
 * On /delete-account, clicks the delete button, which asks the frame's confirmation with the code
 * `delete-account`, and confirms it.
 */
export async function deleteAccount(page: Page): Promise<void> {
  await page.getByTestId('user.delete-account.delete-button').click()
  await expect(
    page.locator('[data-testid="app-shell.confirmation"][data-code="delete-account"]'),
  ).toBeVisible()
  await page.getByTestId('app-shell.confirmation.confirm-button').click()
}
