/**
 * The session tokens the device was given but keeps no more while their sessions still live at
 * the gateway: those the sign-outs forgot without the gateway signing them out (offline, or giving
 * unsent changes up), and those of sign-ins that did not finish. Each is signed out with the
 * device it named. Each is kept first (`perch.session.pending-revoke`, one list for every account
 * signed out on this browser, at most 8), so a page closed before the gateway answered leaves it
 * for the next start, and is sent at once while the browser is online, else at the next start
 * online, and in any case before the next sign-in; it is forgotten once the gateway took it. A
 * token the browser's storage will not keep is held in memory for the page's lifetime. No token
 * is ever logged or reported, nor the cause of a failure, whose text may carry one.
 */

import { type DataError, dataError } from '@workspace/data'

import type { GatewayAuth } from '../gateway-auth'
import {
  addPendingRevoke,
  deviceIdFrom,
  forgetDevice,
  forgetPendingRevoke,
  type KeyValueStorage,
  type PendingToken,
  pendingRevokes,
  savedToken,
} from '../storage'

/**
 * Whether the token a sign-out forgets still works at the gateway: `live` when it did not sign it
 * out (the device was offline), which leaves it to sign out later; `dead` when it signed it out
 * or refused it.
 */
export type KeysLeft = 'live' | 'dead'

export interface PendingRevokeOptions {
  readonly auth: GatewayAuth
  readonly storage: KeyValueStorage
  /** Whether the browser says it has a network: only then is a token left to sign out sent unasked. */
  readonly online: () => boolean
  readonly onError: (error: DataError) => void
}

/**
 * What the gateway's answer to a sign-out means for its token: gone (signed out, or refused for
 * good) or still to sign out; and the failure worth reporting, if any.
 */
interface SignOutAnswer {
  readonly gone: boolean
  readonly failure?: DataError
}

/** The browser's storage would not keep a token left to sign out. */
const unkeptToken = (): DataError =>
  dataError('data:WRITE_FAILED', 'a token could not be kept for revocation on this browser')

export class PendingRevoke {
  readonly #options: PendingRevokeOptions
  #sending: Promise<void> = Promise.resolve()
  /**
   * The tokens left to sign out that the browser's storage would not keep (its quota full, say):
   * held for the page's lifetime, and tried first by every send.
   */
  readonly #unkept: PendingToken[] = []

  constructor(options: PendingRevokeOptions) {
    this.#options = options
  }

  /**
   * Forgets who is signed in and the token; a token that still works is left to sign out first,
   * and sent at once while the browser is online.
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
   * Leaves a token the device was given but keeps no more (a sign-in that did not finish, or
   * another tab signed someone else in meanwhile) to sign out. It is kept first, so a page closed
   * before the gateway answered leaves it for the next start. While the browser is online it is
   * then sent on its own, once any send under way has ended, and forgotten once the gateway took
   * it; the send does not rest on reading the token back from the browser's storage, which may
   * have refused to keep it. Offline it waits for the next send.
   */
  leave(token: string): void {
    const left: PendingToken = { token, device: deviceIdFrom(this.#options.storage) }

    this.#hold(left)

    if (this.#options.online()) {
      void this.#chain(() => this.#sendLeft(left), 'could not send a token left to sign out')
    }
  }

  /**
   * Keeps the token the device holds now to sign out later, after the tokens kept before, another
   * account's among them. More than 8 waiting drops the oldest, which is reported.
   */
  keep(): void {
    const storage = this.#options.storage
    const token = savedToken(storage)

    if (token !== undefined) {
      this.#hold({ token, device: deviceIdFrom(storage) })
    }
  }

  /**
   * Sends every token left to sign out, one after the other, once any send under way has ended:
   * those held in memory first, then those the storage keeps; each is kept or forgotten on its own
   * answer. Signed out, or refused as dead (it signs nobody in any more), a token is forgotten; so
   * is a token whose request the gateway refuses otherwise (any other 4xx), which it will never
   * take, a failure being reported. A gateway that cannot be reached or asks to wait leaves it for
   * the next try quietly; one that could not sign it out (5xx) leaves it too, the failure being
   * reported. The send never fails to its caller. Each token has its own boundary: one whose send
   * or report throws is kept, the throw reported, and the next token is sent all the same; a
   * failure of one send, even a throw, leaves the next send to run.
   */
  send(): Promise<void> {
    return this.#chain(() => this.#sendAll(), 'could not send the tokens left to sign out')
  }

  /**
   * Runs `work` once any send under way has ended. A failure of it, even a throw, is reported as
   * `failure`, nothing of the throw kept, and leaves the next send to run.
   */
  #chain(work: () => Promise<void>, failure: string): Promise<void> {
    this.#sending = this.#sending
      .then(work)
      .catch(() => this.#report(dataError('data:WRITE_FAILED', failure)))

    return this.#sending
  }

  /**
   * Keeps `left` to sign out later, after the tokens kept before; more than 8 waiting drops the
   * oldest, which is reported. Read back once written: a token the storage did not keep (the
   * browser's storage drops a write it refuses) is held in memory instead, and reported.
   */
  #hold(left: PendingToken): void {
    let dropped: readonly PendingToken[] = []

    try {
      dropped = addPendingRevoke(this.#options.storage, left)
    } catch {
      // Read back below: a token the write did not keep is held in memory.
    }

    if (dropped.length > 0) {
      this.#report(
        dataError(
          'data:WRITE_FAILED',
          `${dropped.length} token(s) left to sign out dropped: more were waiting than are kept`,
        ),
      )
    }

    if (this.#stored(left) || this.#unkept.some((each) => each.token === left.token)) {
      return
    }

    this.#unkept.push(left)
    this.#report(unkeptToken())
  }

  /** Whether the storage keeps `left` to sign out; a storage that cannot be read keeps nothing. */
  #stored(left: PendingToken): boolean {
    try {
      return pendingRevokes(this.#options.storage).some((each) => each.token === left.token)
    } catch {
      return false
    }
  }

  async #sendAll(): Promise<void> {
    for (const left of [...this.#unkept]) {
      await this.#sendKept(left)
    }

    for (const left of pendingRevokes(this.#options.storage)) {
      await this.#sendKept(left)
    }
  }

  /** Sends a token kept to sign out, forgotten once gone; a throw is reported and keeps it. */
  async #sendKept(left: PendingToken): Promise<void> {
    try {
      await this.#sendLeft(left)
    } catch {
      this.#report(dataError('data:WRITE_FAILED', 'could not send a token left to sign out'))
    }
  }

  /** Sends a token kept to sign out on its own, and forgets it once the gateway took it. */
  async #sendLeft(left: PendingToken): Promise<void> {
    const answer = await this.#signOut(left)

    if (answer.gone) {
      this.#forget(left)
    }

    this.#tell(answer)
  }

  /**
   * Forgets `left`, wherever it is kept: in memory, or in the storage, whose tokens another tab
   * kept meanwhile stay.
   */
  #forget(left: PendingToken): void {
    const at = this.#unkept.findIndex((each) => each.token === left.token)

    if (at >= 0) {
      this.#unkept.splice(at, 1)
    }

    if (this.#stored(left)) {
      forgetPendingRevoke(this.#options.storage, left.token)
    }
  }

  /**
   * Asks the gateway to sign `left` out. The failure it answers is reported by its code and
   * message only: its cause is left out, and so is a message that names the token.
   */
  async #signOut(left: PendingToken): Promise<SignOutAnswer> {
    const answer = await this.#options.auth.signOut(left.token, left.device)

    if (answer.isOk()) {
      return { gone: true }
    }

    const { code, message } = answer.error
    const failure = dataError(
      code,
      message.includes(left.token) ? 'the gateway could not sign a token out' : message,
    )

    switch (code) {
      case 'data:AUTH_FAILED':
        return { gone: true }
      case 'data:WRITE_REJECTED':
        return { gone: true, failure }
      case 'data:OFFLINE':
      case 'data:RATE_LIMITED':
        return { gone: false }
      default:
        return { gone: false, failure }
    }
  }

  #tell(answer: SignOutAnswer): void {
    if (answer.failure) {
      this.#report(answer.failure)
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
}
