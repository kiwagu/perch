import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import type { EmailConfirmed } from '../../platform/session.port'
import type { AccountSession, GatewayAuth } from '../gateway-auth'
import {
  deviceIdFrom,
  type KeyValueStorage,
  savedToken,
  saveIdentityEmail,
  savePasswordReset,
} from '../storage'

/** What the calls about an account need: the gateway, the browser's storage, who is signed in. */
export interface SessionAccountDeps {
  readonly auth: GatewayAuth
  readonly storage: KeyValueStorage
  /** Whether a session is open on this device now. */
  readonly signedIn: () => boolean
}

/**
 * The calls about an account that sign nothing in or out: the mails of a password reset and the
 * links they carry, the changes of the signed-in account's password and email, the confirmation of
 * a new email and the deletion of the account. The signed-in account's own calls present the
 * session this device holds; the others, which come with a link or an email, present none.
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
   * Asks the gateway alone: it signs nothing in, and a device of the account it signs out, this one
   * included, hears so on its channel (4002). Once it did, the browser's other tabs hear of it.
   */
  resetPassword(token: string, password: string): ResultAsync<void, DataError> {
    return this.#deps.auth
      .resetPassword(token, password)
      .andTee(() => savePasswordReset(this.#deps.storage))
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
    return this.#deps.auth
      .confirmEmail(token)
      .andTee(({ identity, email }) => saveIdentityEmail(this.#deps.storage, identity, email))
  }

  /** Asks the gateway with this device's session; the account stays as it is until the link is used. */
  requestAccountDeletion(password: string): ResultAsync<void, DataError> {
    return this.#session().andThen((session) =>
      this.#deps.auth.requestAccountDeletion(password, session),
    )
  }

  /**
   * Asks the gateway alone. The gateway ends every session of the account and closes its channels
   * (4001), so a device signed in to it signs out as it does when another device signs it out;
   * nothing is signed out here by the call.
   */
  deleteAccount(token: string): ResultAsync<void, DataError> {
    return this.#deps.auth.deleteAccount(token)
  }

  /** The session this device is signed in with, for a change of its account; none signed in fails. */
  #session(): ResultAsync<AccountSession, DataError> {
    const token = savedToken(this.#deps.storage)

    return token === undefined || !this.#deps.signedIn()
      ? errAsync(dataError('data:AUTH_FAILED', 'nobody is signed in on this device'))
      : okAsync({ token, device: deviceIdFrom(this.#deps.storage) })
  }
}
