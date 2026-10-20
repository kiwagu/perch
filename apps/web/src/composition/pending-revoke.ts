/**
 * The pairs of keys the sign-outs forgot without the gateway revoking them: offline, or giving
 * unsent changes up. Their refresh grants still work at the gateway, so each pair is kept with
 * the device it signed out (`perch.session.pending-revoke`, one list for every account signed out
 * on this browser, at most 8) and sent to be revoked at once while the browser is online, else at
 * the next start online, and in any case before the next sign-in, after which the device's
 * session at the gateway holds another grant and the pair could no longer be matched to it. No
 * pair is ever logged.
 */

import { type DataError, dataError } from '@workspace/data'

import type { GatewayAuth } from './gateway-auth'
import {
  addPendingRevoke,
  deviceIdFrom,
  forgetDevice,
  forgetPendingRevoke,
  type KeyValueStorage,
  type PendingPair,
  pendingRevokes,
  savedKeys,
} from './storage'

/**
 * Whether the keys a sign-out forgets still work at the gateway: `live` when it did not revoke
 * them (the device was offline), which leaves them to revoke later; `dead` when it revoked or
 * refused them.
 */
export type KeysLeft = 'live' | 'dead'

export interface PendingRevokeOptions {
  readonly auth: GatewayAuth
  readonly storage: KeyValueStorage
  /** Whether the browser says it has a network: only then is a pair left to revoke sent unasked. */
  readonly online: () => boolean
  readonly onError: (error: DataError) => void
}

export class PendingRevoke {
  readonly #options: PendingRevokeOptions
  #sending: Promise<void> = Promise.resolve()

  constructor(options: PendingRevokeOptions) {
    this.#options = options
  }

  /**
   * Forgets who is signed in and the keys; keys that still work are left to revoke first, and
   * sent at once while the browser is online.
   */
  forgetKeys(keys: KeysLeft): void {
    if (keys === 'live') {
      this.keep()
    }

    forgetDevice(this.#options.storage)

    if (keys === 'live' && this.#options.online()) {
      void this.send()
    }
  }

  /**
   * Keeps the pair the device holds now to revoke later, after the pairs kept before, another
   * account's among them. More than 8 waiting drops the oldest, which is reported.
   */
  keep(): void {
    const storage = this.#options.storage
    const keys = savedKeys(storage)

    if (keys?.refresh === undefined) {
      return
    }

    const dropped = addPendingRevoke(storage, {
      access: keys.access,
      refresh: keys.refresh,
      device: deviceIdFrom(storage),
    })

    if (dropped.length > 0) {
      this.#report(
        dataError(
          'data:WRITE_FAILED',
          `${dropped.length} pair(s) left to revoke dropped: more were waiting than are kept`,
        ),
      )
    }
  }

  /**
   * Sends every pair left to revoke, one after the other, once any send under way has ended;
   * each is kept or forgotten on its own answer. Revoked, or refused as dead (it signs nobody in
   * any more), a pair is forgotten; so is a pair whose request the gateway refuses otherwise (any
   * other 4xx), which it will never take, a failure being reported. A gateway that cannot be
   * reached or could not revoke it (5xx) leaves it for the next try, the latter being reported.
   * The send never fails to its caller. Each pair has its own boundary: one whose send or report
   * throws is kept, the throw reported, and the next pair is sent all the same; a failure of one
   * send, even a throw, leaves the next send to run.
   */
  send(): Promise<void> {
    this.#sending = this.#sending
      .then(() => this.#sendAll())
      .catch((cause: unknown) =>
        this.#report(
          dataError('data:WRITE_FAILED', 'could not send the pairs left to revoke', cause),
        ),
      )

    return this.#sending
  }

  async #sendAll(): Promise<void> {
    for (const pair of pendingRevokes(this.#options.storage)) {
      try {
        await this.#sendOne(pair)
      } catch (cause: unknown) {
        this.#report(dataError('data:WRITE_FAILED', 'could not send a pair left to revoke', cause))
      }
    }
  }

  /** Reports `error`; an error hook that throws has nobody left to tell. */
  #report(error: DataError): void {
    try {
      this.#options.onError(error)
    } catch {
      // Nobody is left to tell.
    }
  }

  #sendOne(pair: PendingPair): Promise<void> {
    // Another tab's pairs, kept meanwhile, stay: only this one goes.
    const forget = () => forgetPendingRevoke(this.#options.storage, pair.refresh)

    return this.#options.auth
      .signOut({ access: pair.access, refresh: pair.refresh }, pair.device)
      .match(forget, (error) => {
        if (error.code === 'data:AUTH_FAILED') {
          forget()
        } else if (error.code === 'data:WRITE_REJECTED') {
          forget()
          this.#report(error)
        } else if (error.code !== 'data:OFFLINE' && error.code !== 'data:RATE_LIMITED') {
          this.#report(error)
        }
      })
  }
}
