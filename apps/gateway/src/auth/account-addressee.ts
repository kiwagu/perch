import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { accountLocale } from './account-locale'
import { reading } from './device-session-rows'
import identityMailStatement from './surql/identity-mail.surql'

/** What a mail to an account needs of it: its email, its own name, and the language it reads. */
export interface AccountAddressee {
  readonly email: string
  readonly name: string
  readonly locale: Locale
}

/**
 * Why the addressee of an account could not be read: the account itself (gone, unread, or of an
 * unknown shape), or the language its settings name.
 */
export interface AddresseeUnread {
  readonly part: 'account' | 'language'
  readonly error: DataError
}

/** The account a mail is about, as the directory keeps it. */
const identityRow = z.object({
  email: z.string(),
  name: z.string(),
  locale: z.enum(SUPPORTED_LOCALES),
})

/** The identity's row as the directory answered it; none, for an identity that is gone, fails. */
function toIdentityRow(value: unknown): Result<z.output<typeof identityRow>, DataError> {
  const row = identityRow.safeParse(value)

  return row.success
    ? ok(row.data)
    : err(dataError('data:QUERY_FAILED', 'the account of a mail is gone or has an unknown shape'))
}

/**
 * Whom a mail about `identity`'s account goes to: its email, its own name (the one it signed up
 * with; the profile's is the one people see) and the language it reads, the one its settings name
 * once it has settings, the one it signed up in before. An identity that is gone, a row of an
 * unknown shape and settings that could not be read fail, each naming which part did, never a
 * mail in a guessed language. Every mail about an account reads it here, the notice of its
 * deletion too.
 */
export function accountAddressee(
  directory: LocalDb,
  identity: IdentityId,
): ResultAsync<AccountAddressee, AddresseeUnread> {
  return reading(
    directory.db.query<[unknown]>(identityMailStatement, { identity }),
    'the account of a mail could not be read',
  )
    .andThen(([value]) => toIdentityRow(value))
    .mapErr((error): AddresseeUnread => ({ part: 'account', error }))
    .andThen((row) =>
      accountLocale(directory, identity)
        .mapErr((error): AddresseeUnread => ({ part: 'language', error }))
        .map(
          (settings): AccountAddressee => ({
            email: row.email,
            name: row.name,
            locale: settings ?? row.locale,
          }),
        ),
    )
}
