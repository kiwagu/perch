import type { Page, Response } from '@playwright/test'

import type { Mail } from '@workspace/mailbox'

import { appReady, expect } from './fixtures'
import { openDeclaredMail } from './mail-contract'

/**
 * Clicks the send button of /forgot-password and waits up to 10 s for the gateway's answer to that
 * request, waited for from before the click; resolves the answer and the moment the test saw it.
 */
export async function sendResetRequest(
  page: Page,
): Promise<{ readonly answer: Response; readonly answeredAt: number }> {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/auth/request-password-reset'),
    { timeout: 10_000 },
  )

  await page.getByTestId('user.forgot-password.send-button').click()

  const answer = await answered

  return { answer, answeredAt: Date.now() }
}

/** The message of /forgot-password, once it asks to open the link of the mail. */
export const resetRequested = (page: Page) =>
  page.locator('[data-testid="user.forgot-password.message"][data-code="check-your-mail"]')

/**
 * Opens /forgot-password, enters `email` and asks for the mail that sets a new password; waits
 * until the gateway answered and the page asks to open the link of the mail.
 */
export async function askForReset(page: Page, email: string): Promise<void> {
  await page.goto('/forgot-password')
  await appReady(page)
  await page.getByTestId('user.forgot-password.email-input').fill(email)
  await sendResetRequest(page)
  await expect(resetRequested(page)).toBeVisible()
}

/**
 * Waits for the reset mail to `email` after its first `seen` mails, an account's mail in the
 * account's language (`en`, the browser's at its sign-up), holds it to its declaration and opens
 * its link in `page`.
 */
export const openResetMail = (page: Page, email: string, seen: number): Promise<Mail> =>
  openDeclaredMail(
    page,
    'request-password-reset',
    { params: { email }, account: { email, language: 'en' } },
    seen,
  )

/** Enters `password` into the new password of /reset-password and its confirmation, and submits. */
export async function enterNewPassword(page: Page, password: string): Promise<void> {
  await page.getByTestId('user.reset-password.password-input').fill(password)
  await page.getByTestId('user.reset-password.password-confirmation-input').fill(password)
  await page.getByTestId('user.reset-password.submit-button').click()
}
