import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import type { EmailConfirmed } from '../../platform/session.port'
import type { AccountSession, GatewayAuth } from '../gateway-auth'
import {
  deviceIdFrom,
  type KeyValueStorage,
  savedSession,
  savedTokenOf,
  saveIdentityEmail,
  savePasswordReset,
} from '../storage'

/** What the calls about an account need: the gateway, the browser's storage, who is signed in. */
export interface SessionAccountDeps {
  readonly auth: GatewayAuth
  readonly storage: KeyValueStorage
  /**
   * The account signed in here: its space open, or opening at the start. Its calls present the
   * session this browser keeps for it, never one another tab saved for another account since.
   */
  readonly signedInAs: () => IdentityId | undefined
  /**
   * Signs this device out of the account `identity` if it is the one signed in here, as the
   * channel's 4001 does; resolves once done, and never rejects.
   */
  readonly signOutOf: (identity: IdentityId) => Promise<void>
  /**
   * Names the session open on this device now, before a reset asked with its `token` ends it: its
   * sign-out as the channel's 4002 does, run only while that session is still the one open and
   * the browser still keeps `token`, which resolves once done and never rejects; undefined with
   * nobody signed in.
   */
  readonly resetHere: (token: string) => (() => Promise<void>) | undefined
}

/**
 * The calls about an account, which sign nothing in: the mails of a password reset and the links
 * they carry, the changes of the signed-in account's password and email, the confirmation of a
 * new email and the deletion of the account. The signed-in account's own calls present the
 * session this device holds, and so does the reset when a session is open, to hear whether it
 * ended it; the others, which come with a link or an email, present none. Only the gateway's
 * answer to a reset or a deletion signs this device out, as the channel would.
 */
export class SessionAccount {
  readonly #deps: SessionAccountDeps

  constructor(deps: SessionAccountDeps) {
    this.#deps = deps
  }

  /** Asks the gateway alone: the reset signs nothing in or out. */
  requestPasswordReset(email: string): ResultAsync<void, DataError> {
    return this.#deps.auth.requestPasswordReset(email)
  }

  /**
   * Asks the gateway with this device's session when one is open: it signs nothing in, ends every
   * session of the account and closes its channels (4002), which this device may never hear (no
   * Web Locks, or its WebSocket blocked). Once it set the password, the browser's other tabs hear
   * of it; once it answered that this device's session was among those it ended, the session
   * signs out here as on the 4002, and one of another account stays. Resolves once that ran.
   */
  resetPassword(token: string, password: string): ResultAsync<void, DataError> {
    const open = this.#openSession()
    const signOut = open === undefined ? undefined : this.#deps.resetHere(open.token)
    const session = signOut === undefined ? undefined : open

    return this.#deps.auth
      .resetPassword(token, password, session)
      .andTee(() => savePasswordReset(this.#deps.storage))
      .andThen(({ signedOut }) =>
        ResultAsync.fromSafePromise(signedOut && signOut ? signOut() : Promise.resolve()),
      )
  }

  /** Asks the gateway with this device's session; the other devices hear their sign-out (4002). */
  changePassword(currentPassword: string, password: string): ResultAsync<void, DataError> {
    return this.#session().andThen((session) =>
      this.#deps.auth.changePassword({ currentPassword, password }, session),
    )
  }

  /** Asks the gateway with this device's session; nothing changes here until the link is opened. */
  changeEmail(email: string, password: string): ResultAsync<void, DataError> {
    return this.#session().andThen((session) =>
      this.#deps.auth.changeEmail({ email, password }, session),
    )
  }

  /**
   * Asks the gateway alone; the email of the account signed in on this browser, when it is the one
   * that changed, is kept as the new one, so a later sign-in with it is not taken for another
   * account's.
   */
  confirmEmail(token: string): ResultAsync<EmailConfirmed, DataError> {
    // The session the confirmation is asked in: its answer changes the email of that one alone.
    const asked = savedSession(this.#deps.storage)

    return this.#deps.auth
      .confirmEmail(token)
      .andTee(({ identity, email }) =>
        saveIdentityEmail(this.#deps.storage, identity, email, asked),
      )
  }

  /** Asks the gateway with this device's session; the account stays as it is until the link is used. */
  requestAccountDeletion(password: string): ResultAsync<void, DataError> {
    return this.#session().andThen((session) =>
      this.#deps.auth.requestAccountDeletion(password, session),
    )
  }

  /**
   * Asks the gateway alone. The gateway ends every session of the account and closes its channels
   * (4001), which this device may never hear (no Web Locks, or its WebSocket blocked): once the
   * gateway answered with the account it deleted, a session open here for that account signs out
   * as on the 4001, and another account's stays. Resolves once that ran, whichever of the two
   * came first.
   */
  deleteAccount(token: string): ResultAsync<void, DataError> {
    return this.#deps.auth
      .deleteAccount(token)
      .andThen(({ identity }) => ResultAsync.fromSafePromise(this.#deps.signOutOf(identity)))
  }

  /** The session this device is signed in with, for a change of its account; none signed in fails. */
  #session(): ResultAsync<AccountSession, DataError> {
    const session = this.#openSession()

    return session === undefined
      ? errAsync(dataError('data:AUTH_FAILED', 'nobody is signed in on this device'))
      : okAsync(session)
  }

  /** The session this device is signed in with, its account's space open or opening; none without. */
  #openSession(): AccountSession | undefined {
    const here = this.#deps.signedInAs()
    const token = here === undefined ? undefined : savedTokenOf(this.#deps.storage, here)

    return token === undefined ? undefined : { token, device: deviceIdFrom(this.#deps.storage) }
  }
}
