/**
 * The organisations an identity's space follows. A change of memberships opens the databases of
 * new ones and deletes those of the ones the identity left, one change after the other; the
 * organisation databases the device counts for the identity go once it no longer belongs to
 * their organisation.
 */

import { dataError } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import { keysOf, RetainedTenantDatabases } from '../retained-tenant-databases'
import type { TenantSpaces } from '../tenant-space'

import type { LeadingEngine } from './leading-engine'
import type { IdentitySpaceOptions } from './options'

export interface SpaceMembershipsOptions {
  readonly space: IdentitySpaceOptions
  readonly tenants: TenantSpaces
  readonly leading: LeadingEngine
  /** Whether the space is closing: a change of memberships then changes nothing. */
  readonly closing: () => boolean
}

export class SpaceMemberships {
  readonly #space: IdentitySpaceOptions
  readonly #tenants: TenantSpaces
  readonly #leading: LeadingEngine
  readonly #closing: () => boolean
  readonly #retained: RetainedTenantDatabases
  /** The change of memberships under way, if any; the next one waits for it. It never rejects. */
  #changing: Promise<void>

  constructor(options: SpaceMembershipsOptions) {
    const { space, tenants } = options

    this.#space = space
    this.#tenants = tenants
    this.#leading = options.leading
    this.#closing = options.closing
    this.#retained = new RetainedTenantDatabases({
      identity: space.identity.id,
      inventory: space.tenantDatabases,
      deleteTenantLocal: space.deleteTenantLocal,
      open: () => tenants.keys(),
      onError: space.onError,
    })
    // The databases the device holds of organisations the identity left meanwhile go first.
    this.#changing = this.#retained.deleteRetained(keysOf(space.memberships))
  }

  /** Resolves once the change of memberships under way, if any, ended; it never rejects. */
  settled(): Promise<void> {
    return this.#changing
  }

  /** Follows a change of the identity's organisations; see `IdentitySpace.setMemberships`. */
  set(next: readonly Membership[]): Promise<void> {
    this.#changing = this.#changing
      .then(() => this.#change(next))
      .catch((cause: unknown) =>
        this.#space.onError(
          dataError('data:OPEN_FAILED', 'could not follow a change of the memberships', cause),
        ),
      )

    return this.#changing
  }

  /**
   * The organisations the identity belongs to whose database the device counts but this space did
   * not open: by the list it follows, or by a newer one another tab saved and opened from. The
   * count is read first: a tab saves the memberships before it counts their databases.
   */
  unopened(): readonly string[] {
    const counted = this.#space.tenantDatabases.keys()
    const belongs = new Set([
      ...keysOf(this.#tenants.memberships()),
      ...keysOf(this.#space.tenantDatabases.savedMemberships()),
    ])
    const open = new Set(this.#tenants.keys())

    return counted.filter((key) => belongs.has(key) && !open.has(key))
  }

  /** Deletes every organisation database the device counts for the identity, open or not. */
  deleteCounted(): Promise<void> {
    return this.#retained.deleteCounted(this.#space.tenantDatabases.keys())
  }

  /** The engine stops before a database the identity left goes: the next one syncs only those still open. */
  async #change(next: readonly Membership[]): Promise<void> {
    if (this.#closing()) {
      return
    }

    const keys = keysOf(next)

    this.#space.tenantDatabases.add([...keys])

    const { changed, left } = await this.#tenants.change(next)

    if (changed) {
      this.#leading.relead()
    }

    this.#space.tenantDatabases.drop(await this.#tenants.delete(left))
    await this.#retained.deleteRetained(keys)
  }
}
