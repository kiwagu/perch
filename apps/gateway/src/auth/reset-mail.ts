import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { ResetLinks } from './account-links'
import type { AccountMails } from './account-mails'

/** How long a reset link sets a password, in seconds: an hour. */
export const RESET_LINK_LIFETIME_S = 60 * 60

/** As much of the account Better Auth hands over with a reset link as the gateway needs. */
const resetAccount = z.object({ id: idSchemas.identity.schema })

export interface ResetMailerOptions {
  /** Where the account's earlier reset links are ended. */
  readonly links: Pick<ResetLinks, 'keepNewest'>
  /** Where the reset mail is started. */
  readonly mails: Pick<AccountMails, 'resetPassword'>
}

/**
 * Better Auth's `sendResetPassword`, called once it kept a new reset link for an account that
 * has one: it ends the account's earlier links first, so only the newest sets a password, then
 * starts the mail and returns, so the request never waits for the mail. The mail links to the
 * front's own screen with the token; Better Auth's `url`, its own redirecting GET, is not used.
 * Earlier links that could not be ended fail the request, with a fixed message, rather than leave
 * them working.
 */
export function resetMailer(options: ResetMailerOptions) {
  return async (data: { readonly user: unknown; readonly token: string }): Promise<void> => {
    const account = resetAccount.safeParse(data.user)

    if (!account.success) {
      throw new Error('the account of a reset link could not be read')
    }

    const kept = await options.links.keepNewest(account.data.id, data.token)

    if (kept.isErr()) {
      throw new Error('the earlier reset links could not be ended')
    }

    options.mails.resetPassword(account.data.id, data.token)
  }
}
