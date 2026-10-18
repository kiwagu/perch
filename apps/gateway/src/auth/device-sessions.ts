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

import deviceRevokeStatement from './surql/device-revoke.surql'
import deviceSeenStatement from './surql/device-seen.surql'
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

/** A device that signed in or renewed its pair, and the grant its pair holds now. */
export interface DeviceTouch {
  readonly identity: IdentityId
  readonly device: string
  /** The device's label; a renewal names none, and the device keeps the one it has. */
  readonly label?: string
  readonly grant: string
}

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
          grant: input.grant,
          ...(input.label === undefined ? {} : { label: input.label }),
        })
        .retry(),
      `could not record a device of ${input.identity}`,
    ).andThen(([row]) => toRow(row))
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
   * such device. Asking again after a failure completes it.
   */
  revoke(input: {
    readonly identity: IdentityId
    readonly id: DeviceSessionId
  }): ResultAsync<DeviceSessionRow | undefined, DataError> {
    const { identity, id } = input

    return writing(
      this.#directory.db.query<[unknown]>(deviceRevokeStatement, { identity, id }).retry(),
      `could not revoke a device of ${identity}`,
    ).andThen(
      ([row]): ResultAsync<DeviceSessionRow | undefined, DataError> =>
        // NONE: the identity has no such device.
        row === undefined || row === null
          ? okAsync(undefined)
          : toRow(row).asyncAndThen((revoked) => this.#revokeGrant(revoked)),
    )
  }

  /** Revokes the refresh grant the revoked device holds; answers its row. */
  #revokeGrant(revoked: DeviceSessionRow): ResultAsync<DeviceSessionRow, DataError> {
    const { identity, grant } = revoked

    return writing(
      this.#directory.db.query(grantRevokeStatement, { identity, grant }).retry(),
      `could not revoke the grant of a device of ${identity}`,
    ).map(() => revoked)
  }

  /**
   * Signs every device of `identity` out: the tokens issued before now are refused, every
   * refresh grant of the identity is revoked, and every device not revoked yet is marked so.
   * Asking again after a failure completes it.
   */
  revokeAll(identity: IdentityId): ResultAsync<void, DataError> {
    const failed = `could not sign every device of ${identity} out`

    return writing(this.#directory.db.query(sessionsRevokedStatement, { identity }).retry(), failed)
      .andThen(() =>
        writing(this.#directory.db.query(grantsRevokeAllStatement, { identity }).retry(), failed),
      )
      .andThen(() =>
        writing(this.#directory.db.query(devicesRevokeAllStatement, { identity }).retry(), failed),
      )
      .map(() => undefined)
  }
}
