/**
 * The session's side of the signed-in identity's organisations on this device: the memberships
 * are read after the sign-in, then come from the leading tab's channel and from the other tabs
 * through the storage; they are kept in the storage, handed to the identity's space and told to
 * the subscribers, with the organisation chosen on this browser. It keeps the inventory of the
 * organisation databases the device holds for the identity.
 */

import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { IdentitySpace, TenantDatabaseInventory } from '../identity-space'
import {
  type KeyValueStorage,
  savedIdentity,
  savedMemberships,
  savedTenant,
  savedTenantDatabases,
  saveMemberships,
  saveTenant,
  saveTenantDatabases,
} from '../storage'

/** The space of the identity signed in on this tab. */
export interface OpenIdentity {
  readonly space: IdentitySpace
}

export interface SessionOrganisationsOptions {
  readonly storage: KeyValueStorage
  /** The open space of the signed-in identity, if any. */
  readonly open: () => OpenIdentity | undefined
}

export class SessionOrganisations {
  readonly #options: SessionOrganisationsOptions
  readonly #listeners = new Set<() => void>()

  constructor(options: SessionOrganisationsOptions) {
    this.#options = options
  }

  memberships(): readonly Membership[] {
    return this.#options.open()?.space.memberships() ?? []
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  current(): Membership | undefined {
    const space = this.#options.open()?.space
    const key = space?.currentTenant()

    return space?.memberships().find(({ tenant }) => tenant.key === key)
  }

  /**
   * Makes the organisation `key` current and keeps the choice; a key of no membership changes
   * nothing, and one whose database did not open on this device is not kept.
   */
  select(key: string): void {
    const space = this.#options.open()?.space

    if (space?.memberships().some(({ tenant }) => tenant.key === key)) {
      space.selectTenant(key)

      if (space.currentTenant() === key) {
        saveTenant(this.#options.storage, key)
      }

      this.tell()
    }
  }

  /** What the space of `identity` opens with: the memberships kept for it and the organisation chosen last. */
  saved(identity: IdentityId): {
    readonly memberships: readonly Membership[]
    readonly tenant: string | undefined
  } {
    const storage = this.#options.storage

    return { memberships: savedMemberships(storage, identity), tenant: savedTenant(storage) }
  }

  /**
   * The inventory of the organisation databases `identity` has on this device, kept in the
   * storage for the tabs and the sessions to come; each change reads it anew, as other tabs
   * change it too. The storage keeps each identity's apart: a change of this one leaves those
   * kept for other identities as they are. The memberships saved for the identity come with it:
   * every list is saved before the space counts its databases (`apply`, and the sign-in before
   * the space opens).
   */
  databases(identity: IdentityId): TenantDatabaseInventory {
    const storage = this.#options.storage
    const kept = () => savedTenantDatabases(storage, identity)

    return {
      keys: kept,
      savedMemberships: () => savedMemberships(storage, identity),
      add: (keys) => {
        const before = kept()
        const after = [...new Set([...before, ...keys])].sort()

        if (after.length > before.length) {
          saveTenantDatabases(storage, identity, after)
        }
      },
      drop: (keys) => {
        const before = kept()
        const after = before.filter((key) => !keys.includes(key))

        if (after.length < before.length) {
          saveTenantDatabases(storage, identity, after)
        }
      },
    }
  }

  /**
   * The signed-in identity's memberships changed (the gateway said so, or this device created an
   * organisation): they are kept for the other tabs, before the space counts and opens or
   * deletes databases to match; resolves once it has. Nothing changes once another tab signed
   * someone else in.
   */
  apply(next: readonly Membership[]): Promise<void> {
    const space = this.#options.open()?.space

    if (!space || !this.#stillSignedIn(space)) {
      return Promise.resolve()
    }

    saveMemberships(this.#options.storage, space.identity.id, next)

    return this.#follow(space, next)
  }

  /**
   * An organisation this device created is a membership at once: it joins the memberships saved
   * for the identity (the newest list any tab kept, which this tab's space may not have followed
   * yet), in place of one of the same key, and the list is applied; see `apply`.
   */
  adopt(created: Membership): Promise<void> {
    const space = this.#options.open()?.space

    if (!space || !this.#stillSignedIn(space)) {
      return Promise.resolve()
    }

    const saved = savedMemberships(this.#options.storage, space.identity.id)

    return this.apply([...saved.filter(({ tenant }) => tenant.key !== created.tenant.key), created])
  }

  /** Another tab kept new memberships of the identity this tab shows: its space follows them. */
  followSaved(): void {
    const space = this.#options.open()?.space

    if (space && this.#stillSignedIn(space)) {
      void this.#follow(space, savedMemberships(this.#options.storage, space.identity.id))
    }
  }

  /** Tells the subscribers that the memberships or the current organisation changed. */
  tell(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** The identity of `space` is still the one signed in on this browser. */
  #stillSignedIn(space: IdentitySpace): boolean {
    return savedIdentity(this.#options.storage)?.id === space.identity.id
  }

  /** Has the space follow `next`, then tells the subscribers while it is still the open one. */
  async #follow(space: IdentitySpace, next: readonly Membership[]): Promise<void> {
    await space.setMemberships(next)

    if (this.#options.open()?.space === space) {
      this.tell()
    }
  }
}
