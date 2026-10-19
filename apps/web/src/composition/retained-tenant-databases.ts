/**
 * The organisation databases a device holds for an identity beyond those its space has open:
 * kept from an earlier session, or ones that failed to open. They are deleted once the identity
 * no longer belongs to their organisation, and when its space is destroyed.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

/**
 * The organisation databases this device may hold for an identity, kept across its sessions
 * and shared by its tabs, with the memberships saved for it. Every writer saves the memberships
 * before it counts the databases of a list: a database counted for a current membership is in
 * the memberships read after the count.
 */
export interface TenantDatabaseInventory {
  /** Their keys, those of databases not open included. */
  keys(): readonly string[]
  /** Counts the databases of `keys`, before they open. */
  add(keys: readonly string[]): void
  /** Stops counting the databases of `keys`, once they are deleted. */
  drop(keys: readonly string[]): void
  /** The memberships saved for the identity on this device now, by whichever of its tabs heard them last. */
  savedMemberships(): readonly Membership[]
}

/** The keys of the organisations of `memberships`. */
export function keysOf(memberships: readonly Membership[]): ReadonlySet<string> {
  return new Set(memberships.map(({ tenant }) => tenant.key))
}

export interface RetainedTenantDatabasesOptions {
  readonly identity: IdentityId
  readonly inventory: TenantDatabaseInventory
  /** Deletes the database of one organisation of the identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  /** The keys of the organisations whose databases the space has open. */
  readonly open: () => readonly string[]
  readonly onError: (error: DataError) => void
}

/** Deletes the counted organisation databases of an identity that its space does not hold open. */
export class RetainedTenantDatabases {
  readonly #options: RetainedTenantDatabasesOptions

  constructor(options: RetainedTenantDatabasesOptions) {
    this.#options = options
  }

  /**
   * Deletes the organisation databases the device holds for the identity of organisations it no
   * longer belongs to: neither of `keep` (the list this tab follows) nor of the memberships saved
   * for the identity now, which another tab may have heard after this one. The count is read
   * before the saved memberships, so a database another tab counted and opened for a newer
   * membership is kept. Never rejects.
   */
  deleteRetained(keep: ReadonlySet<string>): Promise<void> {
    const counted = this.#options.inventory.keys()
    const saved = keysOf(this.#options.inventory.savedMemberships())

    return this.deleteCounted(counted.filter((key) => !keep.has(key) && !saved.has(key)))
  }

  /**
   * Deletes the counted databases of `keys` that are not open, and stops counting those
   * deleted; one that cannot be deleted is reported and stays counted, for a later change or
   * sign-out to try again. Never rejects.
   */
  async deleteCounted(keys: readonly string[]): Promise<void> {
    const open = new Set(this.#options.open())
    const deleted = await Promise.all(
      keys
        .filter((key) => !open.has(key))
        .map((key) =>
          this.#options.deleteTenantLocal(this.#options.identity, key).match(
            () => [key],
            (error) => {
              this.#options.onError(error)

              return []
            },
          ),
        ),
    )

    this.#options.inventory.drop(deleted.flat())
  }
}
