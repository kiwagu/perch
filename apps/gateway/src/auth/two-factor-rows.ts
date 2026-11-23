import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas, type TwoFactorId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { reading, writing } from './device-session-rows'
import twoFactorConfirmCommitStatement from './surql/two-factor-confirm-commit.surql'
import twoFactorDisableCommitStatement from './surql/two-factor-disable-commit.surql'
import twoFactorReadStatement from './surql/two-factor-read.surql'

/**
 * The key an account's second factor holds: the id of its two-factor row (the enrolment a
 * confirmation names), the secret of its key as Better Auth keeps it, encrypted, and whether a
 * code of the key confirmed it.
 */
export interface TwoFactorKey {
  readonly enrolment: TwoFactorId
  readonly secret: string
  readonly verified: boolean
}

/**
 * Whether an account's second factor is on, and the key its two-factor row holds: none while the
 * account has not started to turn it on, or once it turned it off.
 */
export interface TwoFactorState {
  readonly enabled: boolean
  readonly key: TwoFactorKey | undefined
}

/** What a confirmation did: turned the factor on, or found the enrolment no longer the account's. */
export type TwoFactorConfirmation = 'confirmed' | 'changed'

const stateRow = z.object({
  enabled: z.boolean(),
  row: z
    .object({
      id: idSchemas.two_factor.schema,
      secret: z.string().min(1),
      verified: z.boolean(),
    })
    .nullish(),
})

const confirmation = z.enum(['confirmed', 'changed'])

/** A row of the directory, parsed; its values, the secret among them, are left out of the error. */
function toState(value: unknown): Result<TwoFactorState, DataError> {
  const parsed = stateRow.safeParse(fromDriverValue(value))

  if (!parsed.success) {
    return err(
      dataError('data:QUERY_FAILED', 'the second factor of an account has an unknown shape'),
    )
  }

  const { enabled, row } = parsed.data

  return ok({
    enabled,
    key: row ? { enrolment: row.id, secret: row.secret, verified: row.verified } : undefined,
  })
}

/**
 * The second factor of accounts in the directory, as the settings read and change it where
 * Better Auth's own endpoints would rotate the caller's session: the read of its flag and key,
 * its confirmation and its removal, each one statement of the directory. Better Auth writes the
 * key and the backup codes itself, at an enable and at a renewal; neither the secret nor a code
 * is ever in a failure's text.
 */
export class TwoFactorRows {
  readonly #directory: LocalDb

  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /** Whether the factor of `identity` is on, and the key its row holds. */
  read(identity: IdentityId): ResultAsync<TwoFactorState, DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(twoFactorReadStatement, { identity }),
      `the second factor of ${identity} could not be read`,
    ).andThen(([value]) => toState(value))
  }

  /**
   * Turns the factor of `identity` on for the key of `enrolment`, whose code was right: the
   * account's flag and the row's `verified` change together, and only while `enrolment` is still
   * the row of the account and the factor is off (`changed` otherwise, nothing changed).
   */
  confirm(
    identity: IdentityId,
    enrolment: TwoFactorId,
  ): ResultAsync<TwoFactorConfirmation, DataError> {
    return writing(
      this.#directory.db
        .query<unknown[]>(twoFactorConfirmCommitStatement, { identity, enrolment })
        .retry(),
      `the second factor of ${identity} could not be turned on`,
    ).andThen((results) => {
      const answer = confirmation.safeParse(results.at(-2))

      return answer.success
        ? ok(answer.data)
        : err(
            dataError(
              'data:QUERY_FAILED',
              'the confirmation of a second factor has an unknown shape',
            ),
          )
    })
  }

  /**
   * Turns the factor of `identity` off: its flag, its key and its backup codes, and its pending
   * challenges with the rows counting their codes, in one transaction. An account whose factor is
   * off already changes nothing.
   */
  disable(identity: IdentityId): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db.query(twoFactorDisableCommitStatement, { identity }).retry(),
      `the second factor of ${identity} could not be turned off`,
    ).map(() => undefined)
  }
}
