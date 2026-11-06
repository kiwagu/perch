import { err, ok, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue } from '@workspace/data'
import { type DeviceSessionId, type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * Why a device was signed out from elsewhere, as its session row keeps it for the device's next
 * hello: from another device (`revoked`), by a change of the account's password
 * (`password-changed`), or by a sign-in past the account's limit of devices (`device-limit`).
 */
export const ENDED_REASONS = ['revoked', 'password-changed', 'device-limit'] as const

/** One of `ENDED_REASONS`. */
export type EndedReason = (typeof ENDED_REASONS)[number]

/**
 * A session of a device of an identity, as the directory's `device_session` row records it: one
 * row per sign-in, kept once the session ended.
 */
export interface DeviceSessionRow {
  readonly id: DeviceSessionId
  readonly identity: IdentityId
  /** The id the device names itself with. */
  readonly device: string
  /** A short description of the device, such as "Firefox on Linux". */
  readonly label: string
  /** The session token the device holds; never sent to another device or logged. */
  readonly token: string
  readonly createdAt: Date
  readonly lastSeenAt: Date
  /** When the session ends while it is live, and when it ended once it did. */
  readonly expiresAt: Date
  /**
   * When the session was ended, by a sign-out or another sign-in of its device, once it was; never
   * moved afterwards. Absent while it is live, and for a session that merely expired.
   */
  readonly endedAt?: Date
  /**
   * Why the session was ended from elsewhere, when it was live then (`ENDED_REASONS`); absent for
   * an ending of the device's own, an expiry, and a session that is live.
   */
  readonly endedReason?: EndedReason
}

/** A row of `device_session` as the driver returns it, once its values are plain. */
const deviceSessionRow = z
  .object({
    id: idSchemas.device_session.schema,
    identity: idSchemas.identity.schema,
    device: z.string(),
    label: z.string(),
    token: z.string(),
    created_at: z.date(),
    last_seen_at: z.date(),
    expires_at: z.date(),
    ended_at: z.date().optional(),
    ended_reason: z.enum(ENDED_REASONS).optional(),
  })
  .transform(
    (row): DeviceSessionRow => ({
      id: row.id,
      identity: row.identity,
      device: row.device,
      label: row.label,
      token: row.token,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      ...(row.ended_at === undefined ? {} : { endedAt: row.ended_at }),
      ...(row.ended_reason === undefined ? {} : { endedReason: row.ended_reason }),
    }),
  )

/** When the session of `row` ended, if it ended by `now` (milliseconds since the epoch). */
export function endedAt(row: DeviceSessionRow, now: number): Date | undefined {
  return row.expiresAt.getTime() <= now ? row.expiresAt : undefined
}

/** A row of the directory, parsed; its values are left out of the error, its token among them. */
export function toDeviceSessionRow(value: unknown): Result<DeviceSessionRow, DataError> {
  const parsed = deviceSessionRow.safeParse(fromDriverValue(value))

  return parsed.success
    ? ok(parsed.data)
    : err(dataError('data:QUERY_FAILED', 'a device session of the directory has an unknown shape'))
}

/** A row of the directory, or NONE, parsed. */
export function toOptionalDeviceSessionRow(
  value: unknown,
): Result<DeviceSessionRow | undefined, DataError> {
  return value === undefined || value === null ? ok(undefined) : toDeviceSessionRow(value)
}

/** A read of the directory, as a result. */
export function reading<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:QUERY_FAILED', message, cause))
}

/**
 * A write to the directory, as a result. Every write is sent with the driver's `retry()`: the
 * database may refuse one as a conflict with a concurrent transaction, and each may be replayed.
 */
export function writing<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:WRITE_FAILED', message, cause))
}
