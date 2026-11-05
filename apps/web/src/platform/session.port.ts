import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

export interface SignOutOptions {
  /** Sign out even though this device holds changes the gateway has not received; they are lost. */
  readonly forgetUnsent?: boolean
}

/**
 * The words left for the sign-in page (`user.sign-in.notice-message`), in the rank the contract
 * gives them: of the words it holds, the page says the first. `resend-after-sign-in` when the
 * device was signed out (its keys refused, signed out from another device, or a write landing
 * during its sign-out) while it held changes it had not sent; they are kept on the device, and
 * signing in again as the same identity sends them. `delete-pending` when the device signed out
 * but another tab still held its databases open: they go once that tab closes them.
 * `password-reset-elsewhere` when another tab of this browser set a new password through a reset
 * link, which the tab that asked for the mail follows to the sign-in page. `signed-out-elsewhere`
 * when another device of the identity signed this one out and nothing waited to be sent.
 * `password-changed-elsewhere` when the account's password changed (through a reset link, or on
 * another device), which signed this device out, and nothing waited to be sent.
 */
export const SESSION_NOTICES = [
  'resend-after-sign-in',
  'delete-pending',
  'password-reset-elsewhere',
  'signed-out-elsewhere',
  'password-changed-elsewhere',
] as const

/** A word left for the sign-in page (`SESSION_NOTICES`). */
export type SessionNotice = (typeof SESSION_NOTICES)[number]

/** Whether `code` is a word the sign-in page says. */
export const isSessionNotice = (code: string): code is SessionNotice =>
  SESSION_NOTICES.some((notice) => notice === code)

/** A change the gateway refused and this device undid: what the shell tells the user about. */
export interface PushRejection {
  readonly region: string
  readonly batch: number
  readonly reason: string
  readonly detail: string
  /**
   * The gateway refused the change again once it was undone: the device dropped its copy of the
   * region, with the changes made after the refused one and not sent yet, and loaded it again
   * from the server.
   */
  readonly reloaded: boolean
}

/**
 * What a verification link did on this device: signed it in to the account the first time
 * (`signed-in`), with the name and the language the account signed up with, which its profile and
 * its settings start from; nothing after (`verified-before`).
 */
export type EmailVerified =
  | {
      readonly kind: 'signed-in'
      readonly user: AuthUser
      readonly name: string
      readonly locale: Locale
    }
  | { readonly kind: 'verified-before' }

/** What an email confirmation's link did: the account whose email changed, and its new email. */
export interface EmailConfirmed {
  readonly identity: IdentityId
  readonly email: string
}

/** The signed-in user of the application and the transitions between users. */
export interface SessionPort {
  /**
   * Creates the account and has its verification mail sent; this device is not signed in, and an
   * email that has an account answers the same.
   */
  signUp(input: SignUpInput): ResultAsync<void, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  /**
   * Exchanges the token of a verification link: the first exchange verifies the account's email
   * and signs this device in, as a sign-in does (one at a time with the browser's other sign-ins,
   * refused as `data:OTHER_ACCOUNT` when another account is signed in on this browser by the time
   * the gateway answered, whose new session is then signed out); a link verified before signs
   * nothing in and changes nothing. A link the gateway refuses fails as `data:LINK_EXPIRED` (past
   * its lifetime) or `data:LINK_INVALID`.
   */
  verifyEmail(token: string): ResultAsync<EmailVerified, DataError>
  /**
   * Asks the gateway to send the verification mail of `email` again; it answers alike whether the
   * email has an account not verified yet, a verified one or none. Nothing changes in the session.
   */
  resendVerification(email: string): ResultAsync<void, DataError>
  /**
   * Asks the gateway for the mail whose link sets a new password for the account of `email`; it
   * answers alike whether the email has an account or not. Nothing changes in the session.
   */
  requestPasswordReset(email: string): ResultAsync<void, DataError>
  /**
   * Sets a new password with a reset link's `token`. Nothing is signed in; the gateway signs every
   * device of the account out, this one too when it is signed in to it, which its channel hears as
   * a change of the password (4002), and the other tabs of this browser hear that a new password
   * was set here. A password that breaks the rules fails as
   * `data:PASSWORD_REJECTED`, a link past its hour as `data:LINK_EXPIRED`, another the gateway
   * refuses as `data:LINK_INVALID`.
   */
  resetPassword(token: string, password: string): ResultAsync<void, DataError>
  /**
   * Changes the signed-in account's password with its current one: the gateway signs its other
   * devices out and keeps this one signed in. A wrong current password fails as
   * `data:INVALID_CREDENTIALS`, a new one that breaks the rules as `data:PASSWORD_REJECTED`, and
   * nobody signed in here as `data:AUTH_FAILED`.
   */
  changePassword(currentPassword: string, password: string): ResultAsync<void, DataError>
  /**
   * Asks to change the signed-in account's email, confirmed by its password: the mail whose link
   * makes the change goes to `email`, alike whether it has an account or not. A wrong password
   * fails as `data:INVALID_CREDENTIALS`, an email that is not one as `data:EMAIL_INVALID`.
   */
  changeEmail(email: string, password: string): ResultAsync<void, DataError>
  /**
   * Opens the link of an email confirmation, whoever is signed in here: the account's email is the
   * new one, and when that account is the one signed in on this browser, the browser keeps its new
   * email. Nothing is signed in or out. A link past its day fails as `data:LINK_EXPIRED`, another
   * the gateway refuses as `data:LINK_INVALID`.
   */
  confirmEmail(token: string): ResultAsync<EmailConfirmed, DataError>
  /**
   * Asks to delete the signed-in account, confirmed by its password: the mail whose link deletes
   * it goes to the account's email, and the account stays as it is until that link is used. A
   * wrong password fails as `data:INVALID_CREDENTIALS`, an account that is the only administrator
   * of an organisation with other members as `data:LAST_ADMIN`, a request to wait as
   * `data:RATE_LIMITED`, and nobody signed in here as `data:AUTH_FAILED`.
   */
  requestAccountDeletion(password: string): ResultAsync<void, DataError>
  /**
   * Deletes the account a deletion link's `token` names, whoever is signed in here. The gateway
   * ends every session of the account; when this device is signed in to it, it signs out of it as
   * when its channel hears so (4001), without waiting for a channel it may not have, and the
   * sign-in page says `signed-out-elsewhere`; another account signed in here stays, and so does
   * nobody. A link past its hour fails as `data:LINK_EXPIRED`, another the gateway refuses as
   * `data:LINK_INVALID`, an account that became the only administrator of an organisation with
   * other members as `data:LAST_ADMIN` (the link still works once those members are removed), and
   * a request to wait as `data:RATE_LIMITED`.
   */
  deleteAccount(token: string): ResultAsync<void, DataError>
  /**
   * Signs this device out: `signed-out` once its changes reached the gateway (or were given up
   * with `forgetUnsent`) and its local data is gone; `needs-confirmation`, changing nothing,
   * when changes could not be sent and signing out would lose them.
   */
  signOut(options?: SignOutOptions): ResultAsync<'signed-out' | 'needs-confirmation', DataError>
  /**
   * "Sign out everywhere", called before the gateway is asked to sign every device of the
   * identity out: it names the session open now and returns what to run once the gateway did,
   * this device included. That signs the session out as when its channel hears so (4001),
   * without waiting for a channel it may not have: its keys are dead and forgotten; its data goes
   * unless it holds changes not sent yet, which stay for the next sign-in as the identity, and
   * the sign-in page says which. It resolves once done, and changes nothing once that session
   * has ended (signed out already, maybe with another account, or the same one, signed in
   * since): a late answer signs out only the session that asked.
   */
  signingOutEverywhere(): () => ResultAsync<void, DataError>
  current(): AuthUser | undefined
  subscribe(listener: (user: AuthUser | undefined) => void): () => void
  /**
   * Whether this tab is signing an account in itself right now (a sign-in, or the exchange of a
   * verification link): the account it tells of then is this tab's own doing, which the page that
   * started it follows by its flow.
   */
  signingInHere(): boolean
  /** Resolves once every write so far is durable and projected; reports a write that is not durable. */
  flush(): ResultAsync<void, DataError>
  /**
   * The word the sign-in page says, from two slots: the browser's, which a session left as it
   * ended, and this tab's own (`leaveNotice`). A word on what became of the device's data
   * (`resend-after-sign-in`, `delete-pending`) wins, then this tab's own, then the browser's.
   */
  notice(): SessionNotice | undefined
  /** Takes both words away: the sign-in page said them. */
  clearNotice(): void
  /**
   * Leaves this tab's next sign-in page `notice`, as a screen's flow shows it there on its way: a
   * fact of this tab's move, kept in this tab's memory for the page's lifetime, never the
   * browser's; a sign-in of another account in this tab drops it.
   */
  leaveNotice(notice: SessionNotice): void
  /**
   * Whether the gateway refused the sync protocol of the build this page runs since the page
   * loaded: the sync stopped, and stays stopped until the page loads again.
   */
  protocolRefused(): boolean
  /** The organisations the signed-in identity belongs to, as the gateway last said; none while nobody is signed in. */
  memberships(): readonly Membership[]
  /** Hears the memberships or the current organisation change, a sign-in or sign-out included. */
  subscribeMemberships(listener: () => void): () => void
  /**
   * The organisation the tenant region's reads and writes go to: the one selected last on this
   * browser while the identity belongs to it, otherwise the first by key; none without memberships.
   */
  currentTenant(): Membership | undefined
  /** Makes the organisation `key` current and keeps the choice on this browser; a key of no membership changes nothing. */
  selectTenant(key: string): void
}

export const SESSION = token<SessionPort>('Session')
