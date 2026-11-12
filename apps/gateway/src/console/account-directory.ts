import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { type TenantRole, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { reading } from '../auth/device-session-rows'
import { rolesOf } from '../auth/platform-roles'

import accountReadStatement from './surql/account-read.surql'
import accountsListStatement from './surql/accounts-list.surql'

/** An account as the console's list shows it: never its ban's reason, a password or a token. */
export interface ListedAccount {
  readonly id: IdentityId
  /** Its profile's name, or the name it signed up with while it has no profile. */
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly banned: boolean
  /** Whether `operator` is among its platform roles. */
  readonly operator: boolean
  readonly createdAt: Date
}

/** A page of the accounts a search finds, and their number in all. */
export interface AccountPage {
  readonly accounts: readonly ListedAccount[]
  readonly total: number
}

/** What a list is asked for: a part of the email or of the shown name, the page and its size. */
export interface AccountSearch {
  /** Matched in any case; empty for every account. */
  readonly q: string
  /** From 1. */
  readonly page: number
  readonly size: number
}

/** An organisation of an account, with the account's role there. */
export interface AccountOrganisation {
  readonly key: string
  readonly name: string
  readonly role: TenantRole
}

/** An account as the console's card shows it, for operators alone. */
export interface AccountCard extends ListedAccount {
  /** None until its first sign-in, when its name is the one it signed up with. */
  readonly hasProfile: boolean
  /** When one of its devices was last seen among its sessions still kept; absent when never. */
  readonly lastSeenAt?: Date
  /** Why it was banned, while it is banned and a reason was given. */
  readonly banReason?: string
  /** By key. */
  readonly organisations: readonly AccountOrganisation[]
}

/** An account as both statements answer it. */
const accountRow = z.object({
  id: idSchemas.identity.schema,
  name: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  banned: z.boolean(),
  role: z.string().optional(),
  created_at: z.date(),
})

/** What the list answers. */
const pageAnswer = z.object({
  page: z.array(accountRow),
  total: z.number().int().nonnegative(),
})

/** What the read answers for an account it found. */
const cardAnswer = accountRow.extend({
  has_profile: z.boolean(),
  last_seen: z.date().optional(),
  ban_reason: z.string().optional(),
  organisations: z.array(z.object({ key: z.string(), name: z.string(), role: tenantRole })),
})

function listed(row: z.output<typeof accountRow>): ListedAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    banned: row.banned,
    operator: rolesOf(row.role).includes('operator'),
    createdAt: row.created_at,
  }
}

/** The value a statement in a transaction returns: the last answer but the commit's. */
const returned = (results: readonly unknown[]): unknown => fromDriverValue(results.at(-2))

/** `value` parsed by `schema`; its values are left out of the error. */
function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): Result<T, DataError> {
  const answer = schema.safeParse(value)

  return answer.success
    ? ok(answer.data)
    : err(dataError('data:QUERY_FAILED', `${what} has an unknown shape`))
}

/**
 * The platform's accounts as the console reads them, from the directory, as the namespace user:
 * a page of those a search finds, and one account with its organisations. Each is one statement
 * read in one snapshot; nothing here writes.
 */
export class AccountDirectory {
  readonly #directory: LocalDb

  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /**
   * Page `page` of `size` accounts of those whose email or shown name holds `q` in any case, the
   * newest first and two made at the same instant by their id, with the number of them all, both
   * from one query: a page past the last holds none.
   */
  list({ q, page, size }: AccountSearch): ResultAsync<AccountPage, DataError> {
    return reading(
      this.#directory.db.query<unknown[]>(accountsListStatement, { q, page, size }),
      'could not read the accounts',
    )
      .andThen((results) => parsed(pageAnswer, returned(results), 'a page of accounts'))
      .map(({ page: rows, total }) => ({ accounts: rows.map(listed), total }))
  }

  /** The account of `identity`, or `undefined` when no account has it. */
  read(identity: IdentityId): ResultAsync<AccountCard | undefined, DataError> {
    return reading(
      this.#directory.db.query<unknown[]>(accountReadStatement, { identity }),
      'could not read an account',
    ).andThen((results) => {
      const value = returned(results)

      if (value === undefined || value === null) {
        return ok(undefined)
      }

      return parsed(cardAnswer, value, 'an account').map(
        (row): AccountCard => ({
          ...listed(row),
          hasProfile: row.has_profile,
          ...(row.last_seen === undefined ? {} : { lastSeenAt: row.last_seen }),
          ...(row.ban_reason === undefined ? {} : { banReason: row.ban_reason }),
          organisations: row.organisations,
        }),
      )
    })
  }
}
