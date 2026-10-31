import { isAPIError } from 'better-auth/api'
import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type DeviceSessionId, type IdentityId, idSchemas } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { AuthInstance } from './auth-instance'
import { type DeviceSessionRow, toDeviceSessionRow, writing } from './device-session-rows'
import sessionEndStatement from './surql/device-session-end.surql'
import sessionEndByTokenStatement from './surql/device-session-end-by-token.surql'
import sessionsEndAllStatement from './surql/device-sessions-end-all.surql'

/** Who a live session belongs to: the identity, its email, the device and the session's row. */
export interface SessionCaller {
  readonly identity: IdentityId
  readonly email: string
  /** The id the device the session was opened on names itself with. */
  readonly device: string
  /** The session's `device_session` row. */
  readonly session: DeviceSessionId
}

/** What a session token reads as: a live session and who it belongs to, none, or a failed read. */
export type SessionRead =
  | { readonly kind: 'session'; readonly caller: SessionCaller }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly error: DataError }

/**
 * What ending one session of an identity did: ended it now, found it ended already (both with its
 * row), or found no such session of the identity.
 */
export type SessionRevoke =
  | { readonly kind: 'ended'; readonly row: DeviceSessionRow }
  | { readonly kind: 'already-ended'; readonly row: DeviceSessionRow }
  | { readonly kind: 'missing' }

/**
 * What a sign-out by token did: ended a session that was live until now (`ended`), or found none
 * live to end (`not-live`: one that had expired, now marked ended at its expiry, one ended
 * already, or no session at all).
 */
export type SignOutEnding = 'ended' | 'not-live'

export interface AuthSessionsOptions {
  /** The Better Auth instance, which reads a session by its token. */
  readonly auth: AuthInstance
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** The moment a session ends at. */
  readonly clock: Clock
}

/** What Better Auth answers for a live session, as far as the caller is read from it. */
const sessionAnswer = z.object({
  session: z.object({ id: idSchemas.device_session.schema, device: deviceId }),
  user: z.object({ id: idSchemas.identity.schema, email: z.string() }),
})

const NONE: SessionRead = { kind: 'none' }

/** What the ending of one session answers when the identity has such a session. */
const revokeAnswer = z.object({ ended: z.boolean(), row: z.unknown() })

/** What a sign-out by token answers: whether the row it marked was live, for each row marked. */
const signOutAnswer = z.array(z.boolean())

/** A sign-out as the directory answered it. */
function toSignOutEnding(value: unknown): Result<SignOutEnding, DataError> {
  const answer = signOutAnswer.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the ending of a session has an unknown shape'))
  }

  return ok(answer.data.includes(true) ? 'ended' : 'not-live')
}

/** The ending of one session as the directory answered it; its row's values stay out of errors. */
function toSessionRevoke(value: unknown): Result<SessionRevoke, DataError> {
  if (value === undefined || value === null) {
    return ok({ kind: 'missing' })
  }

  const answer = revokeAnswer.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the ending of a session has an unknown shape'))
  }

  const { ended } = answer.data

  return toDeviceSessionRow(answer.data.row).map(
    (row): SessionRevoke => (ended ? { kind: 'ended', row } : { kind: 'already-ended', row }),
  )
}

/**
 * The headers of a call that carries session token `token` in its raw form; none for a token of
 * another form, which names no session here. A raw token, as a sign-in answers it in its body and
 * as its row holds it, has no `.`. Better Auth also takes the signed form (`<raw>.<signature>`, its
 * `set-auth-token` header), but the gateway ends a session by its raw token, so a device holding
 * the signed one would sign out without ending anything: it is refused at once instead. A token no
 * header can carry (a line break in it) names no session either.
 */
function bearerHeaders(token: string): Headers | undefined {
  if (token.includes('.')) {
    return undefined
  }

  try {
    return new Headers({ authorization: `Bearer ${token}` })
  } catch {
    return undefined
  }
}

/** Whether Better Auth refused the read: the token names no session it serves. */
function refused(cause: unknown): boolean {
  return isAPIError(cause) && (cause.status === 'UNAUTHORIZED' || cause.status === 'FORBIDDEN')
}

/** A read of a session that failed, the database's fault or Better Auth's, not the caller's. */
function failed(cause: unknown): SessionRead {
  return {
    kind: 'failed',
    error: dataError('data:QUERY_FAILED', 'the session could not be read', cause),
  }
}

/**
 * The sessions of devices: read through Better Auth, ended by the gateway's own updates of the
 * directory's `device_session` rows. A session ends when its row's `expires_at` and `ended_at`
 * become the moment it ended, on the gateway's clock; an ending already there is never moved, and
 * the row stays, so its device stays listed with that moment. Better Auth's own endings delete
 * rows instead (the session hooks turn a single delete into such an update, but not a delete of
 * several), so none of them is called here. Better Auth reads the row at every read, with no
 * cache, so an ended session reads as none at once. Nothing here logs, and no error carries a
 * token.
 */
export class AuthSessions {
  readonly #auth: AuthInstance
  readonly #directory: LocalDb
  readonly #clock: Clock

  constructor(options: AuthSessionsOptions) {
    this.#auth = options.auth
    this.#directory = options.directory
    this.#clock = options.clock
  }

  /**
   * Who the live session that holds `token` belongs to, or none: a token nobody holds, one not in
   * its raw form, or one whose session ended or expired. A session whose row is not of the gateway's shape (its key not a
   * device session id, its identity not an identity id, no device) fails as `data:AUTH_FAILED`.
   */
  async read(token: string): Promise<SessionRead> {
    const headers = bearerHeaders(token)

    if (headers === undefined) {
      return NONE
    }

    let answer: unknown

    try {
      answer = await this.#auth.api.getSession({ headers })
    } catch (cause) {
      return refused(cause) ? NONE : failed(cause)
    }

    if (answer === null) {
      return NONE
    }

    const parsed = sessionAnswer.safeParse(answer)

    if (!parsed.success) {
      return {
        kind: 'failed',
        error: dataError('data:AUTH_FAILED', 'a session of the directory has an unknown shape'),
      }
    }

    const { session, user } = parsed.data

    return {
      kind: 'session',
      caller: { identity: user.id, email: user.email, device: session.device, session: session.id },
    }
  }

  /**
   * Ends the session that holds `token`, live or expired, and answers `ended` when it was live
   * until now. An expired one is marked ended at its expiry; nothing changes when no session holds
   * the token, or it ended already.
   */
  signOut(token: string): ResultAsync<SignOutEnding, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(sessionEndByTokenStatement, {
          session_token: token,
          ended_at: this.#now(),
        })
        .retry(),
      'a session could not be ended',
    ).andThen(([answer]) => toSignOutEnding(answer))
  }

  /**
   * Ends session `id` of `identity`, if it is live. Answers `ended` with its row when this call
   * ended it, `already-ended` with its row when it had ended before (asking again answers that),
   * or `missing` when the identity has no such session.
   */
  revoke(identity: IdentityId, id: DeviceSessionId): ResultAsync<SessionRevoke, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(sessionEndStatement, { identity, id, ended_at: this.#now() })
        .retry(),
      `a session of ${identity} could not be ended`,
    ).andThen(([answer]) => toSessionRevoke(answer))
  }

  /**
   * Ends every live session of `identity` and marks every expired one ended at its expiry; a
   * session that ended already keeps its end.
   */
  revokeAll(identity: IdentityId): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(sessionsEndAllStatement, { identity, ended_at: this.#now() })
        .retry(),
      `the sessions of ${identity} could not be ended`,
    ).map(() => undefined)
  }

  #now(): Date {
    return new Date(this.#clock.now())
  }
}
