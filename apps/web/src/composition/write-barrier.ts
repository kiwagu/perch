/**
 * The barrier a sign-out raises over every tab's writes, and the identity's write lock that
 * lets it wait for the writes the tabs admitted before it went up. A write landing after a
 * sign-out's final drain would go with the database, so while a sign-out runs in any tab of
 * the browser no write is taken; one taken before holds the write lock shared until its change
 * is durable, and the sign-out takes it exclusive before it reads what is unsent and deletes.
 */

import { err, ok, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import {
  type LockManagerLike,
  type SyncHint,
  type SyncHints,
  writeLockName,
} from '@workspace/replica/sync'

import { forgetSigningOut, type KeyValueStorage, saveSigningOut, signingOutSince } from './storage'

/** When this tab heard another one begin a sign-out, until it hears the sign-out end. */
export interface HeardSignOut {
  at: number | undefined
}

export interface WriteBarrierOptions {
  /** The browser's Web Locks; without them a write runs at once and a sign-out waits for none. */
  readonly locks: LockManagerLike | undefined
  readonly clock: Clock
  readonly storage: KeyValueStorage
  readonly onError: (error: DataError) => void
}

/**
 * How long a sign-out holds every tab's writes back at most. A sign-out ends well within it (up
 * to 5 seconds for the channel, 10 for the drain and 10 for the gateway's close); a tab that
 * went away during its sign-out leaves the mark behind, and writes must not stay refused for good.
 */
const SIGN_OUT_BARRIER_MS = 60_000

/**
 * How long a sign-out waits for the writes other tabs admitted before its barrier went up. A
 * write is durable within moments; a tab that holds one longer is taken for frozen, and the
 * database is kept rather than deleted under it.
 */
const WRITERS_MS = 10_000

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

export class WriteBarrier {
  readonly #options: WriteBarrierOptions

  constructor(options: WriteBarrierOptions) {
    this.#options = options
  }

  /**
   * Runs a write while holding the identity's write lock shared, until its change is durable:
   * any number of writes run at once, and a sign-out waits for all of them.
   */
  writing<T>(
    identity: IdentityId,
    work: () => ResultAsync<T, DataError>,
  ): ResultAsync<T, DataError> {
    const locks = this.#options.locks

    if (!locks) {
      return work()
    }

    const written = new Promise<Result<T, DataError>>((resolve) => {
      locks
        .request(writeLockName(identity), { mode: 'shared' }, async () => {
          resolve(await work())
        })
        .catch((cause: unknown) => {
          resolve(
            err(
              dataError('data:WRITE_FAILED', `could not take the write lock of ${identity}`, cause),
            ),
          )
        })
    })

    return new ResultAsync(written)
  }

  /**
   * Runs `work` holding the identity's write lock exclusive: every write a tab admitted before
   * the barrier went up has become durable, and none runs meanwhile. A lock that does not come
   * within 10 seconds (a frozen tab) runs `giveUp` in its place, which deletes nothing.
   */
  exclusively<T>(
    identity: IdentityId,
    work: () => ResultAsync<T, DataError>,
    giveUp: () => T,
  ): ResultAsync<T, DataError> {
    const locks = this.#options.locks

    if (!locks) {
      return work()
    }

    const controller = new AbortController()
    const cancel = this.#options.clock.schedule(WRITERS_MS, () => controller.abort())
    const ended = new Promise<Result<T, DataError>>((resolve) => {
      locks
        .request(
          writeLockName(identity),
          { mode: 'exclusive', signal: controller.signal },
          async () => {
            cancel()
            resolve(await work())
          },
        )
        .catch((cause: unknown) => {
          cancel()

          if (!isAbortError(cause)) {
            this.#options.onError(
              dataError(
                'data:WRITE_FAILED',
                `could not wait for the writes of every tab into ${identity}`,
                cause,
              ),
            )
          }

          resolve(ok(giveUp()))
        })
    })

    return new ResultAsync(ended)
  }

  /** Holds every tab's writes back: the other tabs hear of it now, a tab opened later reads it. */
  hold(hints: SyncHints): void {
    saveSigningOut(this.#options.storage, this.#options.clock.now())
    hints.post('sign-out')
  }

  /** The sign-out ended: every tab writes again, and the leader drains what waits. */
  release(hints: SyncHints): void {
    forgetSigningOut(this.#options.storage)
    hints.post('kick')
  }

  /** A sign-out began in this browser, as kept or as `heard`, within the barrier's time and has not ended. */
  signingOut(heard: HeardSignOut | undefined): boolean {
    const now = this.#options.clock.now()
    const began = [signingOutSince(this.#options.storage), heard?.at]

    return began.some((at) => at !== undefined && now - at < SIGN_OUT_BARRIER_MS)
  }

  /** Keeps when another tab began a sign-out, until it hears that sign-out end. */
  hear(heard: HeardSignOut, hint: SyncHint): void {
    if (hint === 'sign-out') {
      heard.at = this.#options.clock.now()
    } else if (hint === 'kick') {
      heard.at = undefined
    }
  }
}
