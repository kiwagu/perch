import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

/** An account of the platform as an operator's list shows it: never a ban's reason. */
export interface ListedAccount {
  readonly id: IdentityId
  /** Its profile's name, or the name it signed up with while it has no profile. */
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly banned: boolean
  /** Whether it is an operator of the platform. */
  readonly operator: boolean
  readonly createdAt: Date
}

/** A page of the accounts a search finds, newest first, and how many it finds in all. */
export interface AccountPage {
  readonly accounts: readonly ListedAccount[]
  readonly total: number
}

/**
 * What a page of accounts is asked for: a part of the email or of the name, in any case ('' for
 * every account), the page from 1, and its size, one of those `accounts.list` pages by.
 */
export interface AccountSearch {
  readonly q: string
  readonly page: number
  readonly size: number
}

/** An organisation of an account, with the account's role in it. */
export interface AccountOrganisation {
  readonly key: string
  readonly name: string
  readonly role: TenantRole
}

/** An account as an operator's card shows it. */
export interface AccountCard extends ListedAccount {
  /** None until its first sign-in, while its name is the one it signed up with. */
  readonly hasProfile: boolean
  /** When one of its devices was last seen among its sessions still kept; absent when never. */
  readonly lastSeenAt?: Date
  /** Why it was banned, while it is banned and a reason was given. */
  readonly banReason?: string
  readonly organisations: readonly AccountOrganisation[]
}

/** The codes `accounts.list` fails with: `failed` for any reason but its own. */
export const LIST_CODES = ['not-operator', 'failed'] as const

export type ListCode = (typeof LIST_CODES)[number]

/** The codes `accounts.read` fails with: `failed` for any reason but its own. */
export const READ_CODES = ['not-operator', 'account-gone', 'failed'] as const

export type ReadCode = (typeof READ_CODES)[number]

/** The codes of each action on an account, as the platform lists them: `failed` for any other. */
export const RENAME_CODES = [
  'name-required',
  'name-too-long',
  'not-operator',
  'account-gone',
  'failed',
] as const
export const CHANGE_EMAIL_CODES = [
  'email-invalid',
  'email-taken',
  'rate-limited',
  'not-operator',
  'account-gone',
  'failed',
] as const
export const BAN_CODES = ['own-account', 'not-operator', 'account-gone', 'failed'] as const
export const UNBAN_CODES = ['not-operator', 'account-gone', 'failed'] as const
export const REVOKE_SESSIONS_CODES = [
  'own-account',
  'not-operator',
  'account-gone',
  'failed',
] as const
export const SEND_RESET_CODES = ['rate-limited', 'not-operator', 'account-gone', 'failed'] as const
export const RESEND_VERIFICATION_CODES = [
  'verified-before',
  'rate-limited',
  'not-operator',
  'account-gone',
  'failed',
] as const
export const REMOVE_CODES = [
  'last-admin',
  'own-account',
  'not-operator',
  'account-gone',
  'failed',
] as const

export type RenameCode = (typeof RENAME_CODES)[number]
export type ChangeEmailCode = (typeof CHANGE_EMAIL_CODES)[number]
export type BanCode = (typeof BAN_CODES)[number]
export type UnbanCode = (typeof UNBAN_CODES)[number]
export type RevokeSessionsCode = (typeof REVOKE_SESSIONS_CODES)[number]
export type SendResetCode = (typeof SEND_RESET_CODES)[number]
export type ResendVerificationCode = (typeof RESEND_VERIFICATION_CODES)[number]
export type RemoveCode = (typeof REMOVE_CODES)[number]

/** Why a console call was not done: a code of its action, and what happened, for the logs. */
export interface ConsoleFailure<Code extends string> {
  readonly code: Code
  readonly message: string
}

/** An action on an account: done, or one of its action's codes. */
export type Acted<Code extends string> = ResultAsync<void, ConsoleFailure<Code>>

/**
 * The platform's accounts at the gateway, for an operator: a page of those a search finds, one
 * account with its organisations, and the actions an operator takes on an account. A call the
 * gateway refuses because the account asking is no operator (`not-operator`) also takes that
 * role off the roles this browser keeps for it.
 */
export interface AccountsPort {
  list(search: AccountSearch): ResultAsync<AccountPage, ConsoleFailure<ListCode>>
  read(id: IdentityId): ResultAsync<AccountCard, ConsoleFailure<ReadCode>>
  /** Sets the name of the account's profile. */
  rename(id: IdentityId, name: string): Acted<RenameCode>
  /** Mails the new email the link that changes it; the account keeps its email until then. */
  changeEmail(id: IdentityId, email: string): Acted<ChangeEmailCode>
  /** Bans the account with `reason`, for operators alone (empty for none), signing it out. */
  ban(id: IdentityId, reason: string): Acted<BanCode>
  unban(id: IdentityId): Acted<UnbanCode>
  /** Signs every device of the account out. */
  revokeSessions(id: IdentityId): Acted<RevokeSessionsCode>
  /** Mails the account the link that sets a new password. */
  sendReset(id: IdentityId): Acted<SendResetCode>
  /** Mails the account the link that verifies its email, again. */
  resendVerification(id: IdentityId): Acted<ResendVerificationCode>
  /** Removes the account for good, as its own deletion would. */
  remove(id: IdentityId): Acted<RemoveCode>
}

export const ACCOUNTS = token<AccountsPort>('Accounts')
