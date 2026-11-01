import { err, ok, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { reading } from './device-session-rows'
import identityByEmailStatement from './surql/identity-by-email.surql'

/** An identity as its email finds it: its key, and its email as the directory keeps it. */
export interface EmailIdentity {
  readonly id: IdentityId
  readonly email: string
}

/** The directory's answer for an identity it found. */
const identityRow = z.object({ key: idSchemas.identity.schema, email: z.string() })

/**
 * The identity whose email is `email`, in any case, or none: the one lookup of an identity by its
 * email, for the auth module and for the organisations, each of which decides what none means.
 * A failure names neither the email nor the row.
 */
export function identityByEmail(
  directory: LocalDb,
  email: string,
): ResultAsync<EmailIdentity | undefined, DataError> {
  return reading(
    directory.db.query<[unknown]>(identityByEmailStatement, { email }),
    'could not read the identity of an email',
  ).andThen(([value]) => {
    if (value === undefined || value === null) {
      return ok(undefined)
    }

    const row = identityRow.safeParse(value)

    return row.success
      ? ok({ id: row.data.key, email: row.data.email })
      : err(dataError('data:QUERY_FAILED', 'an identity found by its email has an unknown key'))
  })
}
