import type { Page } from '@playwright/test'

import type { Mail } from '@workspace/mailbox'

import { expect } from './fixtures'
import { openDeclaredMail } from './mail-contract'

/** The message of the settings' email form, once it asks to open the link of the mail. */
export const emailChangeRequested = (page: Page) =>
  page.locator('[data-testid="user.settings.email.message"][data-code="check-your-mail"]')

/**
 * On /settings, enters `email` as the new email and `password` as the account's, and sends the
 * confirmation; waits until the form asks to open the link of the mail sent to the new email.
 */
export async function askToChangeEmail(page: Page, email: string, password: string): Promise<void> {
  await page.getByTestId('user.settings.email.email-input').fill(email)
  await page.getByTestId('user.settings.email.password-input').fill(password)
  await page.getByTestId('user.settings.email.send-button').click()
  await expect(emailChangeRequested(page)).toBeVisible()
}

/**
 * Waits for the confirmation mail an account whose email is `email` asked for, to `newEmail` after
 * its first `seen` mails, in the account's language (`en`, the browser's at its sign-up), holds it
 * to its declaration and opens its link in `page`.
 */
export const openChangeEmailMail = (
  page: Page,
  { email, newEmail }: { readonly email: string; readonly newEmail: string },
  seen = 0,
): Promise<Mail> =>
  openDeclaredMail(
    page,
    'change-email',
    { params: { email: newEmail }, account: { email, language: 'en' } },
    seen,
  )
