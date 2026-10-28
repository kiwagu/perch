/**
 * `TenantSpaces` keeps an identity's organisation databases in step with its memberships, and
 * knows which one the tenant region's reads and writes go to.
 */

import { ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'

import { openTenantSpace, type TenantSpace } from './tenant-region-space'

export interface TenantSpacesOptions {
  readonly identity: IdentityId
  readonly openLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  readonly schema: ReplicaSchema
  readonly onError: (error: DataError) => void
}

/**
 * The databases of the organisations an identity belongs to, one per membership, and the one the
 * tenant region's reads and writes go to: the one selected while its database is open, otherwise
 * the first by key. A database that does not open is reported and left out: its organisation stays
 * a membership, unavailable on this device (not current, not synced), until a change of
 * memberships asks for it again. Its listeners hear when another one becomes current, or none.
 */
export class TenantSpaces {
  readonly #options: TenantSpacesOptions
  readonly #open: Map<string, TenantSpace>
  readonly #listeners = new Set<() => void>()
  #memberships: readonly Membership[]
  #current: string | undefined

  private constructor(
    options: TenantSpacesOptions,
    memberships: readonly Membership[],
    opened: readonly TenantSpace[],
    current: string | undefined,
  ) {
    this.#options = options
    this.#memberships = memberships
    this.#open = new Map(opened.map((tenant) => [tenant.key, tenant]))
    this.#current = current
    this.#keepCurrent()
  }

  /** Opens the database of each membership; one that does not open is reported and left out. */
  static open(
    options: TenantSpacesOptions,
    memberships: readonly Membership[],
    current: string | undefined,
  ): ResultAsync<TenantSpaces, never> {
    const opening = openEach(
      options,
      memberships.map(({ tenant }) => tenant.key),
    )

    return ResultAsync.fromSafePromise(opening).map(
      (opened) => new TenantSpaces(options, memberships, opened, current),
    )
  }

  memberships(): readonly Membership[] {
    return this.#memberships
  }

  /** The keys of the organisations whose databases are open, in order. */
  keys(): readonly string[] {
    return [...this.#open.keys()].sort()
  }

  spaces(): readonly TenantSpace[] {
    return [...this.#open.values()]
  }

  current(): string | undefined {
    return this.#current
  }

  currentSpace(): TenantSpace | undefined {
    return this.#current === undefined ? undefined : this.#open.get(this.#current)
  }

  /** Makes the open organisation `key` current, or none; a key whose database is not open changes nothing. */
  select(key: string | undefined): void {
    if (key === undefined || this.#open.has(key)) {
      const before = this.currentSpace()

      this.#current = key
      this.#tellIfMoved(before)
    }
  }

  /** Hears another organisation become current, or none; told before the database left is deleted. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  /**
   * Follows a change of memberships: opens the databases of new organisations (one that does not
   * open is reported and left out, so the next change tries it again) and lets go of those of the
   * organisations the identity left, which it answers: the caller deletes them once nothing syncs
   * them any more. `changed` tells whether the set of open databases changed.
   */
  async change(
    next: readonly Membership[],
  ): Promise<{ readonly changed: boolean; readonly left: readonly TenantSpace[] }> {
    const before = this.currentSpace()
    const keys = new Set(next.map(({ tenant }) => tenant.key))
    const left = this.spaces().filter((tenant) => !keys.has(tenant.key))
    const coming = [...keys].filter((key) => !this.#open.has(key))

    this.#memberships = next

    for (const tenant of left) {
      this.#open.delete(tenant.key)
    }

    const opened = await openEach(this.#options, coming)

    for (const tenant of opened) {
      this.#open.set(tenant.key, tenant)
    }

    this.#keepCurrent()
    this.#tellIfMoved(before)

    return { changed: left.length > 0 || opened.length > 0, left }
  }

  /**
   * Deletes the databases of organisations the identity left, and answers the keys of those
   * deleted; a failure is reported.
   */
  delete(left: readonly TenantSpace[]): Promise<readonly string[]> {
    const deleting = left.map((tenant) =>
      tenant.destroy().then(
        () => [tenant.key],
        (cause: unknown) => {
          this.#options.onError(
            dataError(
              'data:WRITE_FAILED',
              `could not delete the local data of organisation ${tenant.key}`,
              cause,
            ),
          )

          return []
        },
      ),
    )

    return Promise.all(deleting).then((keys) => keys.flat())
  }

  #tellIfMoved(before: TenantSpace | undefined): void {
    if (this.currentSpace() !== before) {
      for (const listener of [...this.#listeners]) {
        // A listener that stopped listening while the others were told is not told.
        if (this.#listeners.has(listener)) {
          listener()
        }
      }
    }
  }

  #keepCurrent(): void {
    if (this.#current === undefined || !this.#open.has(this.#current)) {
      this.#current = this.keys()[0]
    }
  }
}

/** Opens the databases of the organisations `keys`; one that does not open is reported and left out. */
async function openEach(
  options: TenantSpacesOptions,
  keys: readonly string[],
): Promise<readonly TenantSpace[]> {
  const opened = await Promise.all(
    keys.map((key) =>
      openTenantSpace({
        key,
        openLocal: () => options.openLocal(options.identity, key),
        schema: options.schema,
        onError: options.onError,
      }).match(
        (tenant): TenantSpace | undefined => tenant,
        (error) => {
          options.onError(error)

          return undefined
        },
      ),
    ),
  )

  return opened.filter((tenant): tenant is TenantSpace => tenant !== undefined)
}
