import { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import { renderInvitationMail } from '@workspace/email'
import { DEFAULT_LOCALE, type Locale } from '@workspace/i18n/translator'
import type { Logger } from '@workspace/logger'

import { accountAddressee, addresseeFailure, type MailFailure } from '../../auth/account-addressee'
import { identityByEmail } from '../../auth/identity-by-email'
import type { MailPort } from '../../mail'

import type { InvitationMailer } from './mailer'

export interface InvitationMailsOptions {
  readonly mail: MailPort
  /** The directory: the account an email belongs to, if any, and the language of an account. */
  readonly directory: LocalDb
  /**
   * The default language of the organisation `key`, from its own settings: none when it names
   * none, a failure when it could not be read.
   */
  readonly organisationLocale: (key: string) => ResultAsync<Locale | undefined, DataError>
  /** The link to the front's invitation screen carrying `token`. */
  readonly link: (token: string) => string
  /** Hears a mail that did not go out, by its code; the request was answered already. */
  readonly log: Pick<Logger, 'error'>
}

/**
 * The mail of an invitation. It starts at once and returns, so the request that asked for it never
 * waits for it. It speaks the recipient's language: the one the settings of the account with the
 * invited email name, or the one that account signed up in before it has settings; an email with
 * no account gets its organisation's default language, else English, whoever invited it. A
 * language that could not be read sends nothing (`mail:LOCALE_UNREADABLE`), and an account that
 * vanished between the two reads sends nothing either (`mail:SEND_FAILED`), never a mail in a
 * guessed language. The mail greets no
 * one by name and names no inviter. A mail that could not be read, written or sent is logged by
 * its code, never with its address, its organisation or its link.
 */
export class InvitationMails implements InvitationMailer {
  readonly #options: InvitationMailsOptions
  /** The mails started whose recipient's language is still being read from the directory. */
  readonly #reading = new Set<Promise<void>>()

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
    key,
  }: Parameters<InvitationMailer['invite']>[0]): void {
    const { link, log, mail } = this.#options

    const language = new ResultAsync(Promise.resolve().then(() => this.#language(email, key)))
    const reading = language
      .match(
        () => undefined,
        () => undefined,
      )
      // A query that threw is the send chain's to log.
      .catch(() => undefined)

    this.#reading.add(reading)
    void reading.then(() => this.#reading.delete(reading))

    void language
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
   * Resolves once every mail started so far has read its recipient's language from the directory,
   * or failed to, for a gateway that closes its directory; a mail the mail server has not taken
   * yet does not hold it, since sending reads nothing.
   */
  async languagesRead(): Promise<void> {
    await Promise.all(this.#reading)
  }

  /**
   * The language the mail is written in: the account with `email`'s, or, when no account has it,
   * the default of the organisation `key`, else English.
   */
  #language(email: string, key: string): ResultAsync<Locale, MailFailure> {
    const { directory, organisationLocale } = this.#options

    return identityByEmail(directory, email)
      .mapErr(
        (): MailFailure => ({
          code: 'mail:SEND_FAILED',
          message: 'the account of an invitation mail could not be read',
        }),
      )
      .andThen((found) =>
        found === undefined
          ? organisationLocale(key)
              .map((locale) => locale ?? DEFAULT_LOCALE)
              .mapErr(
                (): MailFailure => ({
                  code: 'mail:LOCALE_UNREADABLE',
                  message: "the default language of an invitation's organisation could not be read",
                }),
              )
          : accountAddressee(directory, found.id)
              .map((addressee) => addressee.locale)
              .mapErr(addresseeFailure),
      )
  }
}
