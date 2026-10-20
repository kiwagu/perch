/**
 * The organisations of the signed-in identity on this device. `SessionOrganisations` is the
 * session's side of them: the memberships come with the sign-in, from the leading tab's channel
 * and from the other tabs through the storage; they are kept in the storage, handed to the
 * identity's space and told to the subscribers, with the organisation chosen on this browser.
 * It keeps the inventory of the organisation databases the device holds for the identity, and
 * has the keys the organisation routes present renewed. `createOrganisations` is the
 * port over the gateway's routes: an organisation the identity creates is its membership on this
 * device at once, without waiting for the gateway to tell the channel. Invites and removals change
 * other identities' memberships, which the gateway tells their own devices.
 */

import { ResultAsync } from 'neverthrow'

import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import type { SyncHints } from '@workspace/replica/sync'

import type { OrganisationsPort } from '../platform/organisations.port'

import type { IdentitySpace, TenantDatabaseInventory } from './identity-space'
import type { OrganisationsApi } from './organisations-api'
import {
  ACCESS_KEY,
  type KeyValueStorage,
  savedIdentity,
  savedMemberships,
  savedTenant,
  savedTenantDatabases,
  saveMemberships,
  saveTenant,
  saveTenantDatabases,
} from './storage'

/** The space of the identity signed in on this tab, and the hints between the identity's tabs. */
export interface OpenIdentity {
  readonly space: IdentitySpace
  readonly hints: SyncHints
}

export interface SessionOrganisationsOptions {
  readonly storage: KeyValueStorage
  readonly clock: Clock
  /** The open space of the signed-in identity, if any. */
  readonly open: () => OpenIdentity | undefined
}

/** How long renewing the keys waits for the gateway's new pair. */
const RENEW_MS = 10_000

export class SessionOrganisations {
  readonly #options: SessionOrganisationsOptions
  readonly #listeners = new Set<() => void>()
  /** Renewals waiting for the next keys this tab's channel takes, or for its end. */
  readonly #renewals = new Set<(renewed: boolean) => void>()
  /** The renewal under way and the space it renews for; a renewal asked meanwhile joins it. */
  #renewing: { readonly space: IdentitySpace; readonly renewed: Promise<boolean> } | undefined
  /** The space whose channel the gateway ended for good: its keys are renewed no more. */
  #ended: IdentitySpace | undefined

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

  /** Makes the organisation `key` current and keeps the choice; a key of no membership changes nothing. */
  select(key: string): void {
    const space = this.#options.open()?.space

    if (space?.memberships().some(({ tenant }) => tenant.key === key)) {
      saveTenant(this.#options.storage, key)
      space.selectTenant(key)
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

  /** This tab's channel took new keys. */
  renewed(): void {
    for (const renewal of [...this.#renewals]) {
      renewal(true)
    }
  }

  /** The gateway's limits refused the renewal this tab's channel asked for: it gives up at once. */
  renewalRefused(): void {
    for (const renewal of [...this.#renewals]) {
      renewal(false)
    }
  }

  /**
   * This tab's channel ended for good: the gateway refused the keys or signed the device out, and
   * the device signs out. A renewal waiting for new keys gives up at once, and so does every one
   * asked for the same space from now on.
   */
  ended(): void {
    this.#ended = this.#options.open()?.space

    for (const renewal of [...this.#renewals]) {
      renewal(false)
    }
  }

  /**
   * Has the gateway renew the device's keys, as a route that refused the access token asks: the
   * leading tab asks for a new pair over its open channel (one that is down renews at the hello
   * that brings it up); another tab asks the leader with the `renew` hint. True once new keys came
   * within 10 seconds, to this tab's channel or, kept by the leader, into the storage; false at
   * once when this tab's channel ended for good or the gateway's limits refused the renewal. A
   * renewal asked while one is under way joins it: the refresh key works once.
   */
  renewKeys(): Promise<boolean> {
    const open = this.#options.open()

    if (!open || open.space === this.#ended) {
      return Promise.resolve(false)
    }

    if (this.#renewing?.space === open.space) {
      return this.#renewing.renewed
    }

    const renewing = { space: open.space, renewed: this.#renew(open) }

    this.#renewing = renewing
    void renewing.renewed.then(() => {
      if (this.#renewing === renewing) {
        this.#renewing = undefined
      }
    })

    return renewing.renewed
  }

  /** Connects the leader again, or asks it to, and waits up to 10 seconds for the new keys. */
  #renew(open: OpenIdentity): Promise<boolean> {
    return new Promise((resolve) => {
      const stops: Array<() => void> = []
      const finish = (renewed: boolean) => {
        for (const stop of stops.splice(0)) {
          stop()
        }

        resolve(renewed)
      }
      const renewal = (renewed: boolean) => finish(renewed)

      this.#renewals.add(renewal)
      stops.push(
        () => this.#renewals.delete(renewal),
        this.#options.clock.schedule(RENEW_MS, () => finish(false)),
        this.#options.storage.onChangeElsewhere((key) => {
          if (key === ACCESS_KEY) {
            finish(true)
          }
        }),
      )

      if (open.space.sync) {
        open.space.renewSync()
      } else {
        open.hints.post('renew')
      }
    })
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

/** The memberships of the signed-in identity, and how a change of them reaches the device. */
export interface MembershipsHolder {
  memberships(): readonly Membership[]
  applyMemberships(next: readonly Membership[]): Promise<void>
}

export function createOrganisations(
  api: OrganisationsApi,
  session: MembershipsHolder,
): OrganisationsPort {
  return {
    create: (input) =>
      api.create(input).andThen((created) => {
        const others = session
          .memberships()
          .filter(({ tenant }) => tenant.key !== created.tenant.key)

        return ResultAsync.fromSafePromise(session.applyMemberships([...others, created])).map(
          () => created,
        )
      }),
    members: (key) => api.members(key),
    invite: (key, email) => api.invite(key, email),
    remove: (key, identity) => api.remove(key, identity),
  }
}
