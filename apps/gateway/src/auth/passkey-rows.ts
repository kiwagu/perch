import { err, ok, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas, type PasskeyId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { reading, writing } from './device-session-rows'
import passkeyCeremoniesReclaimStatement from './surql/passkey-ceremonies-reclaim.surql'
import passkeyOwnerStatement from './surql/passkey-owner.surql'
import passkeyRemoveStatement from './surql/passkey-remove.surql'
import passkeysOfStatement from './surql/passkeys-of.surql'

/** A passkey of an account as its list shows it: its id and when it was added. */
export interface ListedPasskey {
  readonly id: PasskeyId
  readonly createdAt: Date
}

/**
 * How many expired ceremonies one start of a ceremony reclaims at most: each start leaves one row
 * at most behind, so a backlog of abandoned ones drains over the next starts, and no start's work
 * grows with it.
 */
export const RECLAIMED_PER_CEREMONY = 10

/** What a removal did: removed the account's passkey, or found none of the account by that id. */
export type PasskeyRemoval = 'removed' | 'missing'

const listedRows = z.array(z.object({ id: idSchemas.passkey.schema, created_at: z.date() }))

const owners = z.array(idSchemas.identity.schema)

const removedRows = z.array(z.unknown())

/** A read of the directory that has an unknown shape: nothing of its values is in the error. */
const unknownShape = (what: string): DataError =>
  dataError('data:QUERY_FAILED', `${what} has an unknown shape`)

/**
 * The passkeys of accounts in the directory, as the gateway reads and removes them itself: Better
 * Auth's passkey plugin writes a passkey at a registration and checks one at a sign-in, while the
 * list of an account's passkeys, the account a credential belongs to (read before a sign-in takes
 * that account's turn), a removal, and the reclaim of the ceremonies left unfinished are each one
 * statement of the gateway's. Neither a public key nor a credential id is ever in a failure's text.
 */
export class PasskeyRows {
  readonly #directory: LocalDb

  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /** The passkeys of `identity`, the earliest added first. */
  list(identity: IdentityId): ResultAsync<readonly ListedPasskey[], DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(passkeysOfStatement, { identity }),
      `the passkeys of ${identity} could not be read`,
    ).andThen(([rows]) => {
      const parsed = listedRows.safeParse(fromDriverValue(rows))

      return parsed.success
        ? ok(parsed.data.map((row) => ({ id: row.id, createdAt: row.created_at })))
        : err(unknownShape('a passkey of the directory'))
    })
  }

  /** The account whose passkey holds `credential`; none when no passkey holds it. */
  ownerOf(credential: string): ResultAsync<IdentityId | undefined, DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(passkeyOwnerStatement, { credential }),
      'the account of a passkey could not be read',
    ).andThen(([rows]) => {
      const parsed = owners.safeParse(fromDriverValue(rows))

      return parsed.success ? ok(parsed.data[0]) : err(unknownShape('the account of a passkey'))
    })
  }

  /**
   * Deletes the rows Better Auth's passkey plugin wrote for the options of a registration or of a
   * sign-in whose ceremony was left unfinished, once they expired more than a minute ago, at most
   * `RECLAIMED_PER_CEREMONY` of them: Better Auth's own clean-up of expired rows is off, so nothing
   * else reclaims them. No row of another kind is touched.
   */
  reclaim(): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(passkeyCeremoniesReclaimStatement, { limit: RECLAIMED_PER_CEREMONY })
        .retry(),
      'the expired passkey ceremonies could not be reclaimed',
    ).map(() => undefined)
  }

  /** Removes passkey `passkey` of `identity`; one of another account, or none, is `missing`. */
  remove(identity: IdentityId, passkey: PasskeyId): ResultAsync<PasskeyRemoval, DataError> {
    return writing(
      this.#directory.db.query<[unknown]>(passkeyRemoveStatement, { identity, passkey }).retry(),
      `a passkey of ${identity} could not be removed`,
    ).andThen(([rows]) => {
      const parsed = removedRows.safeParse(rows)

      if (!parsed.success) {
        return err(unknownShape('the removal of a passkey'))
      }

      const removal: PasskeyRemoval = parsed.data.length > 0 ? 'removed' : 'missing'

      return ok(removal)
    })
  }
}
