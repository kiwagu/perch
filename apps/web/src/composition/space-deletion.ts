/**
 * Deleting an identity's local databases without letting another tab hold the session up, and
 * without deleting them under a tab that uses them. The browser deletes a database only once
 * every connection to it closed; the tabs of the identity close theirs when they hear it signed
 * out, but a tab that does not (frozen, or holding the database open some other way) would keep
 * a sign-out waiting for good. Every tab opens an identity's space, and deletes its databases,
 * under the identity's Web Lock: an open waits for a delete under way, and a delete that comes
 * after the identity was signed in again finds its databases in use and deletes nothing. The
 * identity is listed before its databases are deleted and taken off once they are gone or in
 * use again, so a delete held up past the page's life, or one that failed, runs at the next start.
 */

import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import type { LockManagerLike } from '@workspace/replica/sync'

import type { IdentitySpace } from './identity-space'
import {
  addLeftoverIdentity,
  dropLeftoverIdentity,
  leftoverIdentities,
} from './leftover-identities'
import { RetainedTenantDatabases, type TenantDatabaseInventory } from './retained-tenant-databases'
import { type KeyValueStorage, savedIdentity, saveNotice } from './storage'

/**
 * How long a sign-out waits for its delete. Deleting a closed database takes moments, a little
 * longer while the engine's worker lets go of it; one still held after this is held by another tab.
 */
export const DELETE_GRACE_MS = 5_000

/** The Web Lock under which every tab opens an identity's space and deletes its databases. */
export const spaceLockName = (identity: IdentityId): string => `perch-space:${identity}`

/**
 * How a delete went within the grace: done; its databases in use again (the identity was signed
 * in again first), so nothing was deleted; or still held up by another tab and going on.
 */
export type DeleteOutcome = 'deleted' | 'in-use' | 'pending'

export interface SpaceDeletionOptions {
  readonly storage: KeyValueStorage
  readonly clock: Clock
  /** The browser's Web Locks; without them this page's opens and deletes still take turns. */
  readonly locks: LockManagerLike | undefined
  /** Deletes the identity's own database while it is not open. */
  readonly deleteLocal: (identity: IdentityId) => ResultAsync<void, DataError>
  /** Deletes the database of one organisation of an identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  /** The organisation databases the device holds for an identity. */
  readonly inventory: (identity: IdentityId) => TenantDatabaseInventory
  readonly onError: (error: DataError) => void
}

const failedFor = (identity: IdentityId, cause: unknown) =>
  dataError('data:WRITE_FAILED', `could not delete the local data of ${identity}`, cause)

export class SpaceDeletion {
  readonly #options: SpaceDeletionOptions
  /** Without Web Locks: the last open or delete of each identity this page started. */
  readonly #turns = new Map<IdentityId, Promise<unknown>>()

  constructor(options: SpaceDeletionOptions) {
    this.#options = options
  }

  /**
   * Closes the space and deletes its databases: `deleted` once they are all gone, `in-use` when
   * the identity was signed in again first, `pending` when the delete is still held up after the
   * grace, which leaves it going, the identity listed until it ends and the sign-in page a word; a
   * failure within the grace fails, one after it is reported. The space closes before the lock is
   * taken, so a tab never holds the database open while it waits for another tab's delete of it;
   * the grace runs from the close.
   */
  destroy(
    space: Pick<IdentitySpace, 'identity' | 'close' | 'destroy'>,
  ): ResultAsync<DeleteOutcome, DataError> {
    const identity = space.identity.id

    // Listed first: a page that goes during the close still leaves the databases to the next start.
    addLeftoverIdentity(this.#options.storage, identity)

    // A close that fails fails the destroy, which closes first: it is not told twice.
    return ResultAsync.fromSafePromise(space.close().catch(() => undefined)).andThen(() =>
      this.#withinGrace(
        this.#deleteUnlessInUse(identity, () =>
          ResultAsync.fromPromise(space.destroy(), (cause) => failedFor(identity, cause)).andThen(
            () => this.#nothingLeft(identity),
          ),
        ),
      ),
    )
  }

  /**
   * Deletes the databases of an identity whose space did not open, its own and every
   * organisation database counted for it, as `destroy` does those of an open one.
   */
  deleteUnopened(identity: IdentityId): ResultAsync<DeleteOutcome, DataError> {
    addLeftoverIdentity(this.#options.storage, identity)

    return this.#withinGrace(this.#deleteUnlessInUse(identity, () => this.#deleteClosed(identity)))
  }

  /**
   * Deletes the databases of every listed identity but the one signed in on this browser; one that
   * fails stays listed and is reported. Never rejects.
   */
  async deleteLeftovers(): Promise<void> {
    const signedIn = savedIdentity(this.#options.storage)?.id
    const left = leftoverIdentities(this.#options.storage).filter(
      (identity) => identity !== signedIn,
    )

    await Promise.all(
      left.map((identity) =>
        this.#deleteUnlessInUse(identity, () => this.#deleteClosed(identity)).match(
          () => undefined,
          (error) => this.#options.onError(error),
        ),
      ),
    )
  }

  /**
   * Opens an identity's space under its lock: after a delete of its databases under way in any
   * tab, and before one that would start meanwhile. Once it is open the identity is listed no
   * more, its databases in use; an open that fails leaves it listed, for the next start to delete.
   */
  open<T>(identity: IdentityId, open: () => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    return this.#locked(
      identity,
      () => open().andTee(() => dropLeftoverIdentity(this.#options.storage, identity)),
      (cause) => dataError('data:OPEN_FAILED', `could not take the lock of ${identity}`, cause),
    )
  }

  /**
   * Runs a delete of the identity's databases under its lock, unless the identity is signed in on
   * this browser again by then: its databases are in use, and it is listed no more. A delete that
   * succeeds takes the identity off the list; one that fails leaves it listed.
   */
  #deleteUnlessInUse(
    identity: IdentityId,
    work: () => ResultAsync<void, DataError>,
  ): ResultAsync<'deleted' | 'in-use', DataError> {
    const storage = this.#options.storage

    return this.#locked(
      identity,
      () => {
        if (savedIdentity(storage)?.id === identity) {
          dropLeftoverIdentity(storage, identity)

          return okAsync('in-use' as const)
        }

        return work().map(() => {
          dropLeftoverIdentity(storage, identity)

          return 'deleted' as const
        })
      },
      (cause) => failedFor(identity, cause),
    )
  }

  /** Runs `work` holding the identity's lock; without Web Locks, after this page's earlier turn. */
  #locked<T>(
    identity: IdentityId,
    work: () => ResultAsync<T, DataError>,
    failed: (cause: unknown) => DataError,
  ): ResultAsync<T, DataError> {
    const locks = this.#options.locks

    if (!locks) {
      const turn = (this.#turns.get(identity) ?? Promise.resolve()).then(() => work())

      this.#turns.set(identity, turn)

      return new ResultAsync(turn)
    }

    const done = new Promise<Result<T, DataError>>((resolve) => {
      locks
        .request(spaceLockName(identity), { mode: 'exclusive' }, async () => {
          resolve(await work())
        })
        .catch((cause: unknown) => resolve(err(failed(cause))))
    })

    return new ResultAsync(done)
  }

  /**
   * How `deleting` went within the grace, which runs from now; a failure after it is reported,
   * nobody waiting for it any more.
   */
  #withinGrace(
    deleting: ResultAsync<'deleted' | 'in-use', DataError>,
  ): ResultAsync<DeleteOutcome, DataError> {
    const answer = new Promise<Result<DeleteOutcome, DataError>>((resolve) => {
      let answered = false
      const cancel = this.#options.clock.schedule(DELETE_GRACE_MS, () => {
        answered = true
        // The sign-in page says the data goes once the other tabs are closed.
        saveNotice(this.#options.storage, 'delete-pending')
        resolve(ok('pending'))
      })

      void deleting.match(
        (outcome) => {
          cancel()
          resolve(ok(outcome))
        },
        (error) => {
          cancel()

          if (answered) {
            this.#options.onError(error)
          } else {
            resolve(err(error))
          }
        },
      )
    })

    return new ResultAsync(answer)
  }

  /** Fails while an organisation database stays counted for the identity: one was not deleted. */
  #nothingLeft(identity: IdentityId): Result<void, DataError> {
    return this.#options.inventory(identity).keys().length === 0
      ? ok(undefined)
      : err(failedFor(identity, new Error('an organisation database stays')))
  }

  /**
   * Deletes the databases of an identity whose space is not open here: its own, then every
   * organisation database counted for it. Fails when one of them stays.
   */
  #deleteClosed(identity: IdentityId): ResultAsync<void, DataError> {
    const inventory = this.#options.inventory(identity)
    const tenants = new RetainedTenantDatabases({
      identity,
      inventory,
      deleteTenantLocal: this.#options.deleteTenantLocal,
      open: () => [],
      onError: this.#options.onError,
    })

    return this.#options
      .deleteLocal(identity)
      .andThen(() => ResultAsync.fromSafePromise(tenants.deleteCounted(inventory.keys())))
      .andThen(() => this.#nothingLeft(identity))
  }
}
