/**
 * The pair of keys a sign-out forgot without the gateway revoking it: offline, or giving
 * unsent changes up. Its refresh grant still works at the gateway, so the pair is kept
 * (`perch.session.pending-revoke`) and sent to be revoked at once while the browser is online,
 * else at the next start online, and in any case before the next sign-in, after which the
 * device's session at the gateway holds another grant and the pair could no longer be matched
 * to it. The pair is never logged.
 */

import { type DataError, dataError } from '@workspace/data'

import type { GatewayAuth } from './gateway-auth'
import {
  deviceIdFrom,
  forgetPendingRevoke,
  type KeyValueStorage,
  pendingRevoke,
  savedKeys,
  savePendingRevoke,
} from './storage'

export interface PendingRevokeOptions {
  readonly auth: GatewayAuth
  readonly storage: KeyValueStorage
  readonly onError: (error: DataError) => void
}

export class PendingRevoke {
  readonly #options: PendingRevokeOptions
  #sending: Promise<void> = Promise.resolve()

  constructor(options: PendingRevokeOptions) {
    this.#options = options
  }

  /** Keeps the pair the device holds now to revoke later, in place of one kept before. */
  keep(): void {
    const keys = savedKeys(this.#options.storage)

    if (keys?.refresh !== undefined) {
      savePendingRevoke(this.#options.storage, { access: keys.access, refresh: keys.refresh })
    }
  }

  /**
   * Sends the pair left to revoke, if one waits, once any send under way has ended. Revoked,
   * or refused as dead (it signs nobody in any more), it is forgotten; so is a pair whose
   * request the gateway refuses otherwise (any other 4xx), which it will never take, a failure
   * being reported. A gateway that cannot be reached or could not revoke it (5xx) leaves it for
   * the next try, the latter being reported. The send never fails to its caller, and a failure
   * of one send, even a throw, leaves the next one to run.
   */
  send(): Promise<void> {
    this.#sending = this.#sending
      .then(() => this.#sendOnce())
      .catch((cause: unknown) =>
        this.#options.onError(
          dataError('data:WRITE_FAILED', 'could not send the pair left to revoke', cause),
        ),
      )
      // An error hook that throws has nobody left to tell.
      .catch(() => undefined)

    return this.#sending
  }

  #sendOnce(): Promise<void> {
    const storage = this.#options.storage
    const pair = pendingRevoke(storage)

    if (!pair) {
      return Promise.resolve()
    }

    const forget = () => {
      // A pair another tab left meanwhile waits for its own send.
      if (pendingRevoke(storage)?.refresh === pair.refresh) {
        forgetPendingRevoke(storage)
      }
    }

    return this.#options.auth.signOut(pair, deviceIdFrom(storage)).match(forget, (error) => {
      if (error.code === 'data:AUTH_FAILED') {
        forget()
      } else if (error.code === 'data:WRITE_REJECTED') {
        forget()
        this.#options.onError(error)
      } else if (error.code !== 'data:OFFLINE') {
        this.#options.onError(error)
      }
    })
  }
}
