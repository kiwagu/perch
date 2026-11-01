import type { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { DeviceSessionId, IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import type { AuthInstance } from '../auth-instance'
import { writing } from '../device-session-rows'
import { identityByEmail } from '../identity-by-email'
import sessionEndStatement from '../surql/device-session-end.surql'
import sessionEndByTokenStatement from '../surql/device-session-end-by-token.surql'
import sessionsEndAllStatement from '../surql/device-sessions-end-all.surql'
import sessionsEndOthersStatement from '../surql/device-sessions-end-others.surql'

import {
  type SessionRevoke,
  type SignOutEnding,
  toEndedDevices,
  toSessionRevoke,
  toSignOutEnding,
} from './endings'
import { readSession, type SessionRead } from './read'
import { readSignedIn, readVerificationEmail, type SignedInAccount } from './verification'

export interface AuthSessionsOptions {
  /** The Better Auth instance, which reads a session by its token. */
  readonly auth: AuthInstance
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** The moment a session ends at. */
  readonly clock: Clock
  /** Better Auth's secret, which signs a verification link's token. */
  readonly secret: string
}

/**
 * The sessions of devices: read through Better Auth, ended by the gateway's own updates of the
 * directory's `device_session` rows. A session ends when its row's `expires_at` and `ended_at`
 * become the moment it ended, on the gateway's clock; an ending already there is never moved, and
 * the row stays, so its device stays listed with that moment. Better Auth's own endings delete
 * rows instead (the session hooks turn a single delete into such an update, but not a delete of
 * several), so none of them is called here. Better Auth reads the row at every read, with no
 * cache, so an ended session reads as none at once. It also reads what a verification needs: the
 * session it signed in, the identity of an email, the email of a link's token. Nothing here logs,
 * and no error carries a token or an address.
 */
export class AuthSessions {
  readonly #auth: AuthInstance
  readonly #directory: LocalDb
  readonly #clock: Clock
  readonly #secret: string

  constructor(options: AuthSessionsOptions) {
    this.#auth = options.auth
    this.#directory = options.directory
    this.#clock = options.clock
    this.#secret = options.secret
  }

  /** Who the live session that holds `token` belongs to, or none (`readSession`). */
  read(token: string): Promise<SessionRead> {
    return readSession(this.#auth, token)
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

  /**
   * Ends every live session of `identity` but session `keep`, and marks every expired one but it
   * ended at its expiry; a session that ended already keeps its end. Answers the devices whose
   * session was live until now, each once.
   */
  revokeOthers(
    identity: IdentityId,
    keep: DeviceSessionId,
  ): ResultAsync<readonly string[], DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(sessionsEndOthersStatement, { identity, keep, ended_at: this.#now() })
        .retry(),
      `the other sessions of ${identity} could not be ended`,
    ).andThen(([answer]) => toEndedDevices(answer))
  }

  /**
   * The session Better Auth signed in at a verification, by the signed token of its answer, and
   * its account (`readSignedIn`). Devices never present the signed form: `read` refuses it.
   */
  signedIn(signedToken: string): ResultAsync<SignedInAccount | undefined, DataError> {
    return readSignedIn(this.#auth, signedToken)
  }

  /** The identity whose email is `email`, in any case; none when no account has it. */
  identityOf(email: string): ResultAsync<IdentityId | undefined, DataError> {
    return identityByEmail(this.#directory, email).map((identity) => identity?.id)
  }

  /**
   * The email a verification link's token names, in lower case, or none
   * (`readVerificationEmail`).
   */
  verificationEmail(token: string): Promise<string | undefined> {
    return readVerificationEmail(token, this.#secret)
  }

  #now(): Date {
    return new Date(this.#clock.now())
  }
}
