/**
 * Deleting an identity's local databases without letting another tab hold the session up. The
 * browser deletes a database only once every connection to it closed; the tabs of the identity
 * close theirs when they hear it signed out, but a tab that does not (frozen, or holding the
 * database open some other way) would keep a sign-out waiting for good. The identity is listed
 * before its databases are deleted and taken off once they are gone, so a delete held up past
 * the page's life is run again at the next start.
 */

import { err, ok, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

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

/** How a delete went within the grace: done, or still held up by another tab and going on. */
export type DeleteOutcome = 'deleted' | 'pending'

export interface SpaceDeletionOptions {
  readonly storage: KeyValueStorage
  readonly clock: Clock
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
  /** The deletes this page started, by identity, each until it ended. */
  readonly #running = new Map<IdentityId, Promise<unknown>>()

  constructor(options: SpaceDeletionOptions) {
    this.#options = options
  }

  /**
   * Closes the space and deletes its databases: `deleted` once they are gone, `pending` when the
   * delete is still held up after the grace, which leaves it going, the identity listed until it
   * ends and the sign-in page a word; a failure within the grace fails, one after it is reported. The grace runs from
   * the close: it times the delete, which another tab can hold up, not the space's own close.
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
        this.#run(identity, () =>
          ResultAsync.fromPromise(space.destroy(), (cause) => failedFor(identity, cause)),
        ),
      ),
    )
  }

  /**
   * Deletes the databases of an identity whose space did not open, its own and every
   * organisation database counted for it, as `destroy` does those of an open one.
   */
  deleteUnopened(identity: IdentityId): ResultAsync<DeleteOutcome, DataError> {
    return this.#withinGrace(this.#run(identity, () => this.#deleteClosed(identity)))
  }

  /**
   * Deletes the databases of every listed identity but the one signed in on this browser now
   * and those whose delete this page runs already; one that fails stays listed and is reported.
   * Never rejects.
   */
  async deleteLeftovers(): Promise<void> {
    const signedIn = savedIdentity(this.#options.storage)?.id
    const left = leftoverIdentities(this.#options.storage).filter(
      (identity) => identity !== signedIn && !this.#running.has(identity),
    )

    await Promise.all(
      left.map((identity) =>
        this.#run(identity, () => this.#deleteClosed(identity)).match(
          () => undefined,
          (error) => this.#options.onError(error),
        ),
      ),
    )
  }

  /**
   * Resolves once a delete of `identity` this page runs, if any, has ended, as the browser
   * would before it opens the database again; the identity is then listed no more: its
   * databases are about to be in use.
   */
  async beforeOpen(identity: IdentityId): Promise<void> {
    await this.#running.get(identity)
    dropLeftoverIdentity(this.#options.storage, identity)
  }

  /** Lists the identity, runs the delete, and takes the identity off the list once it succeeded. */
  #run(
    identity: IdentityId,
    work: () => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    addLeftoverIdentity(this.#options.storage, identity)

    const deleting = work().andTee(() => dropLeftoverIdentity(this.#options.storage, identity))
    const ended = Promise.resolve(deleting).then(() => {
      if (this.#running.get(identity) === ended) {
        this.#running.delete(identity)
      }
    })

    this.#running.set(identity, ended)

    return deleting
  }

  /** How `deleting` went within the grace; a failure after it is reported, nobody waiting for it any more. */
  #withinGrace(deleting: ResultAsync<void, DataError>): ResultAsync<DeleteOutcome, DataError> {
    const answer = new Promise<Result<DeleteOutcome, DataError>>((resolve) => {
      let answered = false
      const cancel = this.#options.clock.schedule(DELETE_GRACE_MS, () => {
        answered = true
        // The sign-in page says the data goes once the other tabs are closed.
        saveNotice(this.#options.storage, 'delete-pending')
        resolve(ok('pending'))
      })

      void deleting.match(
        () => {
          cancel()
          resolve(ok('deleted'))
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
      .andThen(() =>
        inventory.keys().length === 0
          ? ok(undefined)
          : err(failedFor(identity, new Error('an organisation database stays'))),
      )
  }
}
