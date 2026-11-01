import { Result, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import { SESSION_LIFETIME_MS } from './auth-instance'
import {
  type DeviceSessionRow,
  reading,
  toDeviceSessionRow,
  toOptionalDeviceSessionRow,
  writing,
} from './device-session-rows'
import deviceByTokenStatement from './surql/device-by-token.surql'
import deviceSeenStatement from './surql/device-seen.surql'
import devicesOfStatement from './surql/devices-of.surql'
import devicesSweepStatement from './surql/devices-sweep.surql'

/** How long a session that ended stays on the list of an identity's devices. */
const ENDED_LISTED_MS = 30 * 24 * 60 * 60 * 1000

export interface DeviceSessionsOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** How long ago a session ended, for the list of devices; when a device is seen. */
  readonly clock: Clock
}

/**
 * Whether `row` comes after `other`: created later, or at the same instant with a greater id, so
 * two rows created at once are told apart the same way every time.
 */
function after(row: DeviceSessionRow, other: DeviceSessionRow): boolean {
  const created = row.createdAt.getTime() - other.createdAt.getTime()

  return created > 0 || (created === 0 && row.id > other.id)
}

/**
 * The latest row of each device among `rows`, which come the earliest first (by creation, then
 * id): the devices in the order of their first rows.
 */
function latestPerDevice(rows: readonly DeviceSessionRow[]): readonly DeviceSessionRow[] {
  const latest = new Map<string, DeviceSessionRow>()

  for (const row of rows) {
    const kept = latest.get(row.device)

    // A device keeps its place in the map, that of its first row; the latest row takes it.
    if (kept === undefined || after(row, kept)) {
      latest.set(row.device, row)
    }
  }

  return [...latest.values()]
}

/**
 * The devices of each identity, as the directory's `device_session` rows record them: one row per
 * sign-in of a device, holding its label, its session token, when it was seen last and when its
 * session ends or ended. Better Auth writes the rows at sign-in; the gateway reads them, marks a
 * device's live session seen (which extends it) and forgets those that ended long ago, as the
 * namespace user. Nothing here logs, and no error carries a token.
 */
export class DeviceSessions {
  readonly #directory: LocalDb
  readonly #clock: Clock

  constructor(options: DeviceSessionsOptions) {
    this.#directory = options.directory
    this.#clock = options.clock
  }

  /**
   * The devices of `identity`: the latest row of each, the device signed in first coming first.
   * Rows whose session ended 30 days ago or more are forgotten first, so a device signed out
   * stays listed for 30 days, with the moment its session ended.
   */
  list(identity: IdentityId): ResultAsync<readonly DeviceSessionRow[], DataError> {
    const before = new Date(this.#clock.now() - ENDED_LISTED_MS)

    return writing(
      this.#directory.db.query(devicesSweepStatement, { identity, before }).retry(),
      `could not forget the ended sessions of ${identity}`,
    )
      .andThen(() =>
        reading(
          this.#directory.db.query<[unknown[]]>(devicesOfStatement, { identity }),
          `could not read the devices of ${identity}`,
        ),
      )
      .andThen(([rows]) => Result.combine(rows.map(toDeviceSessionRow)))
      .map(latestPerDevice)
  }

  /** The session row holding `token`, live or ended; `undefined` when no row holds it. */
  byToken(token: string): ResultAsync<DeviceSessionRow | undefined, DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(deviceByTokenStatement, { session_token: token }),
      'could not read the device of a session',
    ).andThen(([row]) => toOptionalDeviceSessionRow(row))
  }

  /**
   * Records that the device was seen now: its live session is marked seen and slides to a full
   * lifetime again, from now. A session of the device that ended stays as it is, also when this
   * write, or its retry, lands after an ending that committed once its instants were taken.
   */
  seen(input: {
    readonly identity: IdentityId
    readonly device: string
  }): ResultAsync<void, DataError> {
    const now = this.#clock.now()

    return writing(
      this.#directory.db
        .query(deviceSeenStatement, {
          ...input,
          seen_at: new Date(now),
          expires_at: new Date(now + SESSION_LIFETIME_MS),
        })
        .retry(),
      `could not mark a device of ${input.identity} seen`,
    ).map(() => undefined)
  }
}
