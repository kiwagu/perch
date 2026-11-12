/**
 * The session's side of the signed-in identity's organisations on this device: the memberships
 * are read after the sign-in, then come from the leading tab's channel and from the other tabs
 * through the storage; they are kept in the storage, handed to the identity's space and told to
 * the subscribers, with the organisation chosen on this browser. A membership the gateway
 * answered this tab (`adopt`) joins the saved list when it does not name the organisation yet,
 * never in place of an entry a list wrote. It keeps the inventory of the organisation databases
 * the device holds for the identity.
 */

import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { IdentitySpace, TenantDatabaseInventory } from '../identity-space'
import {
  type KeptSession,
  type KeyValueStorage,
  type SignInOwner,
  savedMemberships,
  savedSession,
  savedTenant,
  savedTenantDatabases,
  saveMemberships,
  saveTenant,
  saveTenantDatabases,
} from '../storage'

/** The space of the identity signed in on this tab, and the sign-in it is of. */
export interface OpenIdentity {
  readonly space: IdentitySpace
  readonly signIn: KeptSession
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
    const open = this.#options.open()
    const space = open?.space

    if (open && space?.memberships().some(({ tenant }) => tenant.key === key)) {
      space.selectTenant(key)

      if (space.currentTenant() === key) {
        saveTenant(this.#options.storage, open.signIn.signIn, key)
      }

      this.tell()
    }
  }

  /**
   * What the space of the sign-in `owner` opens with: the memberships kept for it and the
   * organisation chosen last during it.
   */
  saved(owner: SignInOwner): {
    readonly memberships: readonly Membership[]
    readonly tenant: string | undefined
  } {
    const storage = this.#options.storage

    return {
      memberships: savedMemberships(storage, owner),
      tenant: savedTenant(storage, owner.signIn),
    }
  }

  /**
   * The inventory of the organisation databases `identity` has on this device, kept in the
   * storage for the tabs and the sessions to come; each change reads it anew, as other tabs
   * change it too. The storage keeps each identity's apart: a change of this one leaves those
   * kept for other identities as they are. The memberships saved for the identity come with it,
   * those of the sign-in current now while it is the identity's: every list is saved before the
   * space counts its databases (`apply`, and the sign-in before the space opens).
   */
  databases(identity: IdentityId): TenantDatabaseInventory {
    const storage = this.#options.storage
    const kept = () => savedTenantDatabases(storage, identity)

    return {
      keys: kept,
      savedMemberships: () => {
        const current = savedSession(storage)

        return current?.identity === identity ? savedMemberships(storage, current) : []
      },
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
   * The signed-in identity's memberships changed (the gateway said so over the channel): they
   * are kept for the other tabs under the open space's sign-in, before the space counts and
   * opens or deletes databases to match; resolves once it has. Nothing changes once another tab
   * ended that sign-in or saved another one.
   */
  apply(next: readonly Membership[]): Promise<void> {
    const open = this.#options.open()

    if (!open || !this.#stillSignedIn(open)) {
      return Promise.resolve()
    }

    saveMemberships(this.#options.storage, open.signIn, next)

    return this.#follow(open.space, next)
  }

  /**
   * A membership the gateway answered this tab (an organisation created, an invitation accepted)
   * joins the memberships saved for the sign-in of `open`, the newest list any tab kept (which
   * this tab's space may not have followed yet), unless that list names the organisation already:
   * its entry came from a list heard after the gateway's tell, or the next list sets it right, so
   * nothing is written in its place. The check that the sign-in is still the saved one, the
   * read, the write and the start of the follow happen in one step, with no await between them:
   * the follow keeps its place among this tab's writes and the storage events handled after it.
   * Resolves once the space followed the list read or written, waiting for no later list; nothing
   * changes once another tab ended that sign-in or saved another one.
   */
  adopt(open: OpenIdentity, joined: Membership): Promise<void> {
    if (!this.#stillSignedIn(open)) {
      return Promise.resolve()
    }

    const saved = savedMemberships(this.#options.storage, open.signIn)

    if (saved.some(({ tenant }) => tenant.key === joined.tenant.key)) {
      return this.#follow(open.space, saved)
    }

    const next = [...saved, joined]

    saveMemberships(this.#options.storage, open.signIn, next)

    return this.#follow(open.space, next)
  }

  /** Another tab kept new memberships of the sign-in this tab shows: its space follows them. */
  followSaved(): void {
    const open = this.#options.open()

    if (open && this.#stillSignedIn(open)) {
      void this.#follow(open.space, savedMemberships(this.#options.storage, open.signIn))
    }
  }

  /** Tells the subscribers that the memberships or the current organisation changed. */
  tell(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** The sign-in of `open` is still the one saved on this browser. */
  #stillSignedIn(open: OpenIdentity): boolean {
    return savedSession(this.#options.storage)?.signIn === open.signIn.signIn
  }

  /** Has the space follow `next`, then tells the subscribers while it is still the open one. */
  async #follow(space: IdentitySpace, next: readonly Membership[]): Promise<void> {
    await space.setMemberships(next)

    if (this.#options.open()?.space === space) {
      this.tell()
    }
  }
}
