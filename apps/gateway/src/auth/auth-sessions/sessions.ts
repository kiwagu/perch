import { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { DeviceSessionId, IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import { KeyedTurns } from '../../keyed-turns'
import type { AuthInstance } from '../auth-instance'
import { DEVICE_LIMIT } from '../auth-instance'
import { writing } from '../device-session-rows'
import { identityByEmail } from '../identity-by-email'
import sessionEndStatement from '../surql/device-session-end.surql'
import sessionEndByTokenStatement from '../surql/device-session-end-by-token.surql'
import sessionsAdmitStatement from '../surql/device-sessions-admit.surql'
import sessionsEndAllStatement from '../surql/device-sessions-end-all.surql'

import {
  type SessionRevoke,
  type SignInAdmission,
  type SignOutEnding,
  toSessionRevoke,
  toSignInAdmission,
  toSignOutEnding,
} from './endings'
import { readSession, type SessionRead } from './read'
import {
  type MailedVerification,
  readMailedVerification,
  readSignedIn,
  type SignedInAccount,
} from './verification'

export interface AuthSessionsOptions {
  /** The Better Auth instance, which reads a session by its token. */
  readonly auth: AuthInstance
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** The moment a session ends at. */
  readonly clock: Clock
  /** Better Auth's secret, which signs its verification token, and keys the link's around it. */
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
 * session it signed in, the identity of an email, what a link's token names. Nothing here logs,
 * and no error carries a token or an address.
 */
export class AuthSessions {
  readonly #auth: AuthInstance
  readonly #directory: LocalDb
  readonly #clock: Clock
  readonly #secret: string
  /** The admissions of each account, one at a time in this process. */
  readonly #admissions = new KeyedTurns<IdentityId>()

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
   * Admits the sign-in of `identity` whose new session holds `token` against the limit of devices
   * one account keeps signed in at once (`DEVICE_LIMIT`), now, in one transaction, the account's
   * admissions one at a time: within the limit the session is admitted and waits no more
   * (`pending`); past it, a sign-in not confirmed (`signOutOldest` false) has its session deleted
   * and is asked, a confirmed one signs out the account's other device seen least recently, whose
   * session keeps `device-limit` as why it ended. Only admitted sessions count, the new one beside
   * them, so a sign-in still waiting for its admission takes no place from another, a device
   * signed in already takes no new place, and of two sign-ins for the last place one is admitted
   * and the other asked. A session whose admission failed keeps waiting: nothing counts, lists or
   * hands it out.
   */
  admit(
    identity: IdentityId,
    token: string,
    signOutOldest: boolean,
  ): ResultAsync<SignInAdmission, DataError> {
    return new ResultAsync(
      this.#admissions.run(identity, () =>
        writing(
          this.#directory.db
            .query<unknown[]>(sessionsAdmitStatement, {
              session_token: token,
              limit: DEVICE_LIMIT,
              sign_out_oldest: signOutOldest,
              now: this.#now(),
            })
            .retry(),
          'a sign-in could not be admitted',
        ).andThen((results) => toSignInAdmission(results.at(-2))),
      ),
    )
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
   * The verification a link's token names: the account its mail went to, Better Auth's token and
   * its email; none for a token the gateway did not sign as a link's (`readMailedVerification`).
   */
  verificationOf(token: string): Promise<MailedVerification | undefined> {
    return readMailedVerification(token, this.#secret)
  }

  #now(): Date {
    return new Date(this.#clock.now())
  }
}
