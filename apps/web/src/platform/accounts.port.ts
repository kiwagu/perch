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

/** Why a console call was not done: a code of its action, and what happened, for the logs. */
export interface ConsoleFailure<Code extends string> {
  readonly code: Code
  readonly message: string
}

/**
 * The platform's accounts at the gateway, for an operator: a page of those a search finds, and
 * one account with its organisations. A call the gateway refuses because the account asking is
 * no operator (`not-operator`) also takes that role off the roles this browser keeps for it.
 */
export interface AccountsPort {
  list(search: AccountSearch): ResultAsync<AccountPage, ConsoleFailure<ListCode>>
  read(id: IdentityId): ResultAsync<AccountCard, ConsoleFailure<ReadCode>>
}

export const ACCOUNTS = token<AccountsPort>('Accounts')
