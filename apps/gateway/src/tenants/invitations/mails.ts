import { ResultAsync } from 'neverthrow'

import type { LocalDb } from '@workspace/data'
import { renderInvitationMail } from '@workspace/email'
import type { Locale } from '@workspace/i18n/translator'
import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'

import { accountAddressee, addresseeFailure, type MailFailure } from '../../auth/account-addressee'
import { identityByEmail } from '../../auth/identity-by-email'
import type { MailPort } from '../../mail'

import type { InvitationMailer } from './mailer'

export interface InvitationMailsOptions {
  readonly mail: MailPort
  /** The directory: the account an email belongs to, if any, and the language of an account. */
  readonly directory: LocalDb
  /** The link to the front's invitation screen carrying `token`. */
  readonly link: (token: string) => string
  /** Hears a mail that did not go out, by its code; the request was answered already. */
  readonly log: Pick<Logger, 'error'>
}

/**
 * The mail of an invitation. It starts at once and returns, so the request that asked for it never
 * waits for it. It speaks the recipient's language: the one the settings of the account with the
 * invited email name, or the one that account signed up in before it has settings; an email with
 * no account gets the inviter's language, read the same way. A language that could not be read
 * sends nothing (`mail:LOCALE_UNREADABLE`), and an account that vanished between the two reads
 * sends nothing either (`mail:SEND_FAILED`), never a mail in a guessed language. The mail greets no
 * one by name and names no inviter. A mail that could not be read, written or sent is logged by
 * its code, never with its address, its organisation or its link.
 */
export class InvitationMails implements InvitationMailer {
  readonly #options: InvitationMailsOptions

  constructor(options: InvitationMailsOptions) {
    this.#options = options
  }

  /**
   * Starts the mail of the invitation (`#language`, the render, then the mail port). The language
   * lookup starts inside a promise callback, so a query that throws before it hands back anything
   * rejects the chain, which is logged by its code, instead of escaping to the caller.
   */
  invite({
    email,
    organisation,
    role,
    token,
    inviter,
  }: Parameters<InvitationMailer['invite']>[0]): void {
    const { link, log, mail } = this.#options

    void new ResultAsync(Promise.resolve().then(() => this.#language(email, inviter)))
      .andThen((locale) =>
        renderInvitationMail({ to: email, organisation, role, link: link(token), locale }),
      )
      .andThen((message) => mail.send(message))
      .match(
        () => undefined,
        (error) => log.error({ code: error.code }, 'an invitation mail did not go out'),
      )
      .catch(() => log.error({ code: 'mail:SEND_FAILED' }, 'an invitation mail failed'))
  }

  /**
   * The language the mail is written in: the account with `email`'s, or, when no account has it,
   * `inviter`'s.
   */
  #language(email: string, inviter: IdentityId): ResultAsync<Locale, MailFailure> {
    const { directory } = this.#options

    return identityByEmail(directory, email)
      .mapErr(
        (): MailFailure => ({
          code: 'mail:SEND_FAILED',
          message: 'the account of an invitation mail could not be read',
        }),
      )
      .andThen((found) =>
        accountAddressee(directory, found?.id ?? inviter)
          .map((addressee) => addressee.locale)
          .mapErr(addresseeFailure),
      )
  }
}
