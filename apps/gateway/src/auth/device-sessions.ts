import { err, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import {
  type DeviceSessionId,
  device_sessionIdFactory,
  type IdentityId,
  idSchemas,
} from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import deviceOfStatement from './surql/device-of.surql'
import deviceRevokeStatement from './surql/device-revoke.surql'
import deviceRotateStatement from './surql/device-rotate.surql'
import deviceSeenStatement from './surql/device-seen.surql'
import deviceSignedOutStatement from './surql/device-signed-out.surql'
import deviceTouchStatement from './surql/device-touch.surql'
import devicesOfStatement from './surql/devices-of.surql'
import devicesRevokeAllStatement from './surql/devices-revoke-all.surql'
import grantRevokeStatement from './surql/grant-revoke.surql'
import grantsRevokeAllStatement from './surql/grants-revoke-all.surql'
import sessionsRevokedStatement from './surql/identity-sessions-revoked.surql'

/** How long a revoked device stays on the list of an identity's devices. */
const REVOKED_LISTED_MS = 30 * 24 * 60 * 60 * 1000

/** A device of an identity as the directory records it. */
export interface DeviceSessionRow {
  readonly id: DeviceSessionId
  readonly identity: IdentityId
  /** The id the device names itself with. */
  readonly device: string
  /** A short description of the device, such as "Firefox on Linux". */
  readonly label: string
  /** The id of the device's current refresh grant; never sent to a device or logged. */
  readonly grant: string
  readonly createdAt: Date
  readonly lastSeenAt: Date
  /** When the device was signed out from another device, if it was. */
  readonly revokedAt?: Date
}

/** A device that signed in, its label, and the grant its pair holds. */
export interface DeviceTouch {
  readonly identity: IdentityId
  readonly device: string
  readonly label: string
  readonly grant: string
}

/** A device of an identity, as an identity and the id the device names itself with. */
export interface DeviceOf {
  readonly identity: IdentityId
  readonly device: string
}

/**
 * Whether a device has a session: its row, not revoked (`bound`); its row, revoked (`revoked`);
 * no row (`missing`); or, for a renewal, a row that holds another grant than the one the
 * renewal spent (`other-grant`).
 */
export type DeviceBinding =
  | { readonly kind: 'bound'; readonly row: DeviceSessionRow }
  | { readonly kind: 'revoked'; readonly row: DeviceSessionRow }
  | { readonly kind: 'missing' }
  | { readonly kind: 'other-grant' }

/**
 * A sign-out that failed after its first write: what it wrote holds, so the device's sockets
 * (every socket of the identity when no row is named) are to be closed all the same.
 */
export interface PartialSignOut {
  readonly kind: 'partial'
  readonly error: DataError
  readonly row?: DeviceSessionRow
}

/** A sign-out that failed: before it wrote anything, or after (`partial`). */
export type SignOutError = DataError | PartialSignOut

export interface DeviceSessionsOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** How old a revocation is, for the list of devices. */
  readonly clock: Clock
}

/** A row of `device_session` as the driver returns it, once its values are plain. */
const deviceSessionRow = z
  .object({
    id: idSchemas.device_session.schema,
    identity: idSchemas.identity.schema,
    device: z.string(),
    label: z.string(),
    grant: z.string(),
    created_at: z.date(),
    last_seen_at: z.date(),
    revoked_at: z.date().optional(),
  })
  .transform(
    (row): DeviceSessionRow => ({
      id: row.id,
      identity: row.identity,
      device: row.device,
      label: row.label,
      grant: row.grant,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      ...(row.revoked_at === undefined ? {} : { revokedAt: row.revoked_at }),
    }),
  )

/** The binding a device's row, or its absence, makes. */
function bindingOf(row: DeviceSessionRow | undefined): DeviceBinding {
  if (row === undefined) {
    return { kind: 'missing' }
  }

  return row.revokedAt === undefined ? { kind: 'bound', row } : { kind: 'revoked', row }
}

/** A row of the directory, or NONE, parsed. */
function toOptionalRow(value: unknown): Result<DeviceSessionRow | undefined, DataError> {
  return value === undefined || value === null ? ok(undefined) : toRow(value)
}

/** A sign-out that failed after its first write. */
function partial(row?: DeviceSessionRow) {
  return (error: DataError): SignOutError =>
    row === undefined ? { kind: 'partial', error } : { kind: 'partial', error, row }
}

/** A row of the directory, parsed; its values are left out of the error, a grant among them. */
function toRow(value: unknown): Result<DeviceSessionRow, DataError> {
  const parsed = deviceSessionRow.safeParse(fromDriverValue(value))

  return parsed.success
    ? ok(parsed.data)
    : err(dataError('data:QUERY_FAILED', 'a device session of the directory has an unknown shape'))
}

/** A read of the directory, as a result. */
function reading<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:QUERY_FAILED', message, cause))
}

/**
 * A write to the directory, as a result. Every write is sent with the driver's `retry()`: the
 * database may refuse one as a conflict with a concurrent transaction, and each may be replayed.
 */
function writing<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:WRITE_FAILED', message, cause))
}

/**
 * The devices of each identity, as the directory records them: one row per identity and device,
 * holding the device's label, its current refresh grant, when it was seen last and whether it
 * was signed out from another device. The gateway writes them as the namespace user; no record
 * user reads them. Nothing here logs, and no error carries a grant id.
 */
export class DeviceSessions {
  readonly #directory: LocalDb
  readonly #clock: Clock

  constructor(options: DeviceSessionsOptions) {
    this.#directory = options.directory
    this.#clock = options.clock
  }

  /**
   * Records that the device holds `grant` now, seen now and no longer revoked: its row, made on
   * its first sign-in and kept for every later one and every renewal.
   */
  touch(input: DeviceTouch): ResultAsync<DeviceSessionRow, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(deviceTouchStatement, {
          id: device_sessionIdFactory.create(),
          identity: input.identity,
          device: input.device,
          label: input.label,
          grant: input.grant,
        })
        .retry(),
      `could not record a device of ${input.identity}`,
    ).andThen(([row]) => toRow(row))
  }

  /** Whether the device has a session: its row, revoked or not, or none. */
  bind(input: DeviceOf): ResultAsync<DeviceBinding, DataError> {
    const { identity, device } = input

    return reading(
      this.#directory.db.query<[unknown]>(deviceOfStatement, { identity, device }),
      `could not read a device of ${identity}`,
    )
      .andThen(([row]) => toOptionalRow(row))
      .map(bindingOf)
  }

  /**
   * The device renewed its pair: its row moves from grant `spent` to grant `next` and is seen
   * now, only while it holds `spent` and is not revoked (`bound`). Otherwise nothing changes,
   * and the answer says why: `revoked`, `missing`, or `other-grant`.
   */
  rotate(
    input: DeviceOf & { readonly spent: string; readonly next: string },
  ): ResultAsync<DeviceBinding, DataError> {
    const { identity, device, spent, next } = input

    return writing(
      this.#directory.db
        .query<[unknown[]]>(deviceRotateStatement, { identity, device, spent, next })
        .retry(),
      `could not renew a device of ${identity}`,
    )
      .andThen(([rows]) => toOptionalRow(rows[0]))
      .andThen(
        (row): ResultAsync<DeviceBinding, DataError> =>
          row
            ? okAsync({ kind: 'bound', row })
            : this.bind({ identity, device }).map(
                (binding): DeviceBinding =>
                  binding.kind === 'bound' ? { kind: 'other-grant' } : binding,
              ),
      )
  }

  /**
   * The device of `identity` that holds `grant` signed out: its row is marked revoked. Answers
   * the row, or `undefined` when no device of the identity holds the grant or it is revoked
   * already.
   */
  signedOut(input: {
    readonly identity: IdentityId
    readonly grant: string
  }): ResultAsync<DeviceSessionRow | undefined, DataError> {
    return writing(
      this.#directory.db.query<[unknown[]]>(deviceSignedOutStatement, input).retry(),
      `could not mark a device of ${input.identity} signed out`,
    ).andThen(([rows]) => toOptionalRow(rows[0]))
  }

  /** Records that the device was seen now. */
  seen(input: {
    readonly identity: IdentityId
    readonly device: string
  }): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db.query(deviceSeenStatement, input).retry(),
      `could not mark a device of ${input.identity} seen`,
    ).map(() => undefined)
  }

  /**
   * The devices of `identity`, the earliest first: those not revoked, and those revoked within
   * the last 30 days.
   */
  list(identity: IdentityId): ResultAsync<readonly DeviceSessionRow[], DataError> {
    return reading(
      this.#directory.db.query<[unknown[]]>(devicesOfStatement, {
        identity,
        since: new Date(this.#clock.now() - REVOKED_LISTED_MS),
      }),
      `could not read the devices of ${identity}`,
    ).andThen(([rows]) => Result.combine(rows.map(toRow)))
  }

  /**
   * Signs the device of row `id` out, if it is one of `identity`'s: its row is marked revoked,
   * then its refresh grant is revoked. Answers the row, or `undefined` when the identity has no
   * such device; a grant that could not be revoked fails as `partial`, with the row. Asking again
   * after a failure completes it.
   */
  revoke(input: {
    readonly identity: IdentityId
    readonly id: DeviceSessionId
  }): ResultAsync<DeviceSessionRow | undefined, SignOutError> {
    const { identity, id } = input

    return writing(
      this.#directory.db.query<[unknown]>(deviceRevokeStatement, { identity, id }).retry(),
      `could not revoke a device of ${identity}`,
    )
      .andThen(([row]) => toOptionalRow(row))
      .mapErr((error): SignOutError => error)
      .andThen(
        (row): ResultAsync<DeviceSessionRow | undefined, SignOutError> =>
          row === undefined
            ? okAsync(undefined)
            : this.revokeGrant({ identity, grant: row.grant })
                .map(() => row)
                .mapErr(partial(row)),
      )
  }

  /** Revokes refresh grant `grant` of `identity`; nothing when it is not the identity's. */
  revokeGrant(input: {
    readonly identity: IdentityId
    readonly grant: string
  }): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db.query(grantRevokeStatement, input).retry(),
      `could not revoke the grant of a device of ${input.identity}`,
    ).map(() => undefined)
  }

  /**
   * Signs every device of `identity` out: the tokens issued before now are refused, every
   * refresh grant of the identity is revoked, and every device not revoked yet is marked so. A
   * failure after the first write is `partial`. Asking again after a failure completes it.
   */
  revokeAll(identity: IdentityId): ResultAsync<void, SignOutError> {
    const failed = `could not sign every device of ${identity} out`

    return writing(this.#directory.db.query(sessionsRevokedStatement, { identity }).retry(), failed)
      .mapErr((error): SignOutError => error)
      .andThen(() =>
        writing(this.#directory.db.query(grantsRevokeAllStatement, { identity }).retry(), failed)
          .andThen(() =>
            writing(
              this.#directory.db.query(devicesRevokeAllStatement, { identity }).retry(),
              failed,
            ),
          )
          .mapErr(partial()),
      )
      .map(() => undefined)
  }
}
