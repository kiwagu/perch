import type { ResultAsync } from 'neverthrow'

import type { LocalDb } from '@workspace/data'
import {
  renderConfirmEmailMail,
  renderEmailChangedNotice,
  renderPasswordChangedNotice,
  renderResetPasswordMail,
} from '@workspace/email'
import type { IdentityId } from '@workspace/ids'

import type { MailError, MailMessage, MailPort } from '../mail'

import { type AccountAddressee, type AddresseeUnread, accountAddressee } from './account-addressee'
import type { AuthLog } from './auth-log'

/** The front's screen a reset link opens: it sets a new password with the link's token. */
export const RESET_PASSWORD_PATH = '/reset-password'

/** The front's screen a confirmation link opens: it changes the email with the link's token. */
export const CONFIRM_EMAIL_PATH = '/confirm-email'

/** The front's screen that asks for a reset mail, which a password-changed notice links to. */
export const FORGOT_PASSWORD_PATH = '/forgot-password'

/** The link to the front's `path` carrying `token`. */
export const tokenLink = (publicUrl: string, path: string, token: string): string =>
  `${publicUrl}${path}?${new URLSearchParams({ token }).toString()}`

/** A mail that could not be read, written or sent: logged by its code alone. */
interface MailFailure {
  readonly code: string
  readonly message: string
}

/**
 * A mail whose account could not be read: `mail:SEND_FAILED` for the account itself (gone too),
 * `mail:LOCALE_UNREADABLE` for the language its settings name.
 */
function unreadAccount({ part }: AddresseeUnread): MailFailure {
  return part === 'account'
    ? { code: 'mail:SEND_FAILED', message: 'the account of a mail could not be read' }
    : { code: 'mail:LOCALE_UNREADABLE', message: 'the language of a mail could not be read' }
}

export interface AccountMailsOptions {
  readonly mail: MailPort
  /** The directory: the account's email, name and language, and its settings' language. */
  readonly directory: LocalDb
  /** The front's origin, with no trailing slash: the base of every link. */
  readonly publicUrl: string
  /** Hears a mail that did not go out, by its code; the request was answered already. */
  readonly log: AuthLog
}

/**
 * The mails about an account that the gateway sends itself: the reset mail, the confirmation of a
 * new email, and the notices of a changed password and of a changed email. Each starts at once and
 * returns, so the request that asked for it never waits for it. Each speaks the account's
 * language: the one its settings name once it has settings, the one it signed up in before;
 * settings that could not be read send nothing (`mail:LOCALE_UNREADABLE`), never a mail in a
 * guessed language. A mail that could not be read, written or sent is logged by its code, never
 * with its address, its name or its link.
 */
export class AccountMails {
  readonly #options: AccountMailsOptions

  constructor(options: AccountMailsOptions) {
    this.#options = options
  }

  /** The mail with the reset link carrying `token`, to `identity`'s email. */
  resetPassword(identity: IdentityId, token: string): void {
    this.#start(identity, 'a reset mail', (account) =>
      renderResetPasswordMail({
        to: account.email,
        name: account.name,
        link: tokenLink(this.#options.publicUrl, RESET_PASSWORD_PATH, token),
        locale: account.locale,
      }),
    )
  }

  /** The mail to `newEmail` whose link, carrying `token`, makes it `identity`'s email. */
  confirmEmail(identity: IdentityId, newEmail: string, token: string): void {
    this.#start(identity, 'a confirmation mail', (account) =>
      renderConfirmEmailMail({
        to: newEmail,
        name: account.name,
        link: tokenLink(this.#options.publicUrl, CONFIRM_EMAIL_PATH, token),
        locale: account.locale,
      }),
    )
  }

  /** The notice to `identity`'s email that its password changed, linking to asking for a new one. */
  passwordChanged(identity: IdentityId): void {
    this.#start(identity, 'a password-changed notice', (account) =>
      renderPasswordChangedNotice({
        to: account.email,
        name: account.name,
        link: `${this.#options.publicUrl}${FORGOT_PASSWORD_PATH}`,
        locale: account.locale,
      }),
    )
  }

  /**
   * The notice to `oldEmail`, the email `identity` had, that its email changed. It is written from
   * the old email, the account's name and language alone: nothing of the new email reaches it.
   */
  emailChanged(identity: IdentityId, oldEmail: string): void {
    this.#start(identity, 'an email-changed notice', (account) =>
      renderEmailChangedNotice({ to: oldEmail, name: account.name, locale: account.locale }),
    )
  }

  /** Reads the account, writes the mail with `write` and sends it, logging any failure by code. */
  #start(
    identity: IdentityId,
    what: string,
    write: (account: AccountAddressee) => ResultAsync<MailMessage, MailFailure>,
  ): void {
    const { directory, log, mail } = this.#options

    void accountAddressee(directory, identity)
      .mapErr(unreadAccount)
      .andThen(write)
      .andThen((message) => mail.send(message).mapErr((error: MailError): MailFailure => error))
      .match(
        () => undefined,
        (error) => log.error({ code: error.code }, `${what} did not go out`),
      )
      .catch(() => log.error({ code: 'mail:SEND_FAILED' }, `${what} failed`))
  }
}
