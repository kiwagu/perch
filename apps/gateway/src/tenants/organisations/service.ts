import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import { KeyedTurns } from '../../keyed-turns'
import { AccountDeparture } from '../account-departure'
import { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import type { Member } from '../organisation-rows'
import type { TenantDatabases } from '../tenant-databases'
import { TenantMembers } from '../tenant-members'

import { OrganisationCreation } from './creation'
import { OrganisationInvitation } from './invitation'
import { type MembershipListener, MembershipListeners } from './listeners'
import { OrganisationRemoval } from './removal'

export interface OrganisationsOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire' | 'evict'>
  /**
   * Takes the region of an organisation an identity was removed from from that identity's open
   * connections at once; resolves once none of them may name it any more.
   */
  readonly revoke: (identity: IdentityId, region: string) => Promise<void>
}

/** The longest name an organisation may have, in characters. */
const MAX_NAME = 80

/**
 * The organisations of the application and who belongs to them. The directory holds each
 * organisation and every membership; each organisation's own database holds its members, the
 * word its data is checked against. A command that fails with a `DataError` after some of its
 * rows were written leaves those rows in place, and asking again completes it: a creation by its
 * creator, an invite, a removal. Each change of memberships but a departure resolves once the
 * listeners heard the identity's new memberships.
 *
 * The changes of one identity's memberships (its creations, the invites of it, its removals
 * and its departure) run one after the other, each once the one before it, its notification
 * included, has settled: the directory and the organisation's database end as the last one left
 * them, and the listeners hear the lists in that order. This orders them within one gateway
 * process only; gateways running in several processes would need a durable revision of the
 * memberships.
 */
export class Organisations {
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers
  readonly #listeners: MembershipListeners
  readonly #creation: OrganisationCreation
  readonly #invitation: OrganisationInvitation
  readonly #removal: OrganisationRemoval
  readonly #departure: AccountDeparture
  /** Settles once the changes of an identity's memberships asked so far have; gone when idle. */
  readonly #changes = new KeyedTurns<IdentityId>()

  constructor(options: OrganisationsOptions) {
    const { directory, databases, revoke } = options
    const lookup = new OrganisationLookup(directory)
    const members = new TenantMembers(databases)
    const listeners = new MembershipListeners(lookup)

    this.#lookup = lookup
    this.#members = members
    this.#listeners = listeners
    this.#creation = new OrganisationCreation({ directory, databases, lookup, members })
    this.#invitation = new OrganisationInvitation({ directory, lookup, members })
    this.#removal = new OrganisationRemoval({ directory, members, listeners, revoke })
    this.#departure = new AccountDeparture({ directory, databases })
  }

  /** The ready organisations `identity` belongs to, with its role in each, by key. */
  membershipsOf(identity: IdentityId): ResultAsync<readonly Membership[], DataError> {
    return this.#lookup.membershipsOf(identity)
  }

  /**
   * Creates an organisation with `identity` as its admin (`OrganisationCreation`), once its name
   * is trimmed, and tells the creator's listeners.
   */
  create(input: {
    identity: IdentityId
    key: string
    name: string
  }): ResultAsync<Membership, OrganisationError> {
    const { identity, key } = input
    const name = input.name.trim()
    const length = [...name].length

    if (!isTenantKey(key)) {
      return errAsync(refused('invalid-key'))
    }

    if (length < 1 || length > MAX_NAME) {
      return errAsync(refused('invalid-name'))
    }

    return this.#serialize(identity, () =>
      this.#creation
        .create(identity, key, name)
        .andThen((tenant) =>
          this.#listeners.tell(identity).map((): Membership => ({ tenant, role: 'admin' })),
        ),
    )
  }

  /**
   * An admin of the organisation adds the identity that signs in with `email` as a member
   * (`OrganisationInvitation`), and the invited identity's listeners hear it.
   */
  invite(input: {
    actor: IdentityId
    key: string
    email: string
  }): ResultAsync<Member, OrganisationError> {
    const { actor, key, email } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) =>
        this.#lookup.identityByEmail(email).map((identity) => ({ tenant, identity })),
      )
      .andThen(({ tenant, identity }) =>
        this.#serialize(identity.id, () =>
          this.#invitation
            .admit(tenant, identity.id)
            .andThen(() => this.#listeners.tell(identity.id))
            .map((): Member => ({ identity, role: 'member' })),
        ),
      )
  }

  /**
   * An admin of the organisation removes `identity` from it (`OrganisationRemoval`); an admin
   * cannot remove itself.
   */
  remove(input: {
    actor: IdentityId
    key: string
    identity: IdentityId
  }): ResultAsync<void, OrganisationError> {
    const { actor, key, identity } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) => (identity === actor ? errAsync(refused('self')) : okAsync(tenant)))
      .andThen((tenant) => this.#serialize(identity, () => this.#removal.remove(tenant, identity)))
  }

  /**
   * Takes `identity`, whose account goes, out of every organisation (`AccountDeparture.leave`)
   * as a change of its memberships: an invite of it asked meanwhile waits for it. It revokes no
   * region and tells nobody: the caller closes the identity's connections beforehand.
   */
  leaveAll(identity: IdentityId): ResultAsync<void, DataError> {
    return this.#serialize(identity, () => this.#departure.leave(identity))
  }

  /** The members of the organisation with their emails, for its admins, the earliest first. */
  membersOf(input: {
    actor: IdentityId
    key: string
  }): ResultAsync<readonly Member[], OrganisationError> {
    const { actor, key } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen(() => this.#members.list(key))
      .andThen((rows) => this.#lookup.withEmails(key, rows))
  }

  /** Hears that an identity's memberships changed, with the new list. */
  onChange(listener: MembershipListener): () => void {
    return this.#listeners.add(listener)
  }

  /**
   * Runs `work`, a change of the memberships of `identity`, once the changes of that identity
   * asked before it have settled; the next one waits for it, whatever its outcome.
   */
  #serialize<T, E extends OrganisationError>(
    identity: IdentityId,
    work: () => ResultAsync<T, E>,
  ): ResultAsync<T, E> {
    return new ResultAsync(this.#changes.run(identity, work))
  }
}
