import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import { AccountDeparture, type DepartureError } from '../account-departure'
import { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import type { Member, Tenant } from '../organisation-rows'
import type { TenantDatabases } from '../tenant-databases'
import { TenantMembers } from '../tenant-members'

import { OrganisationCreation } from './creation'
import { OrganisationInvitation } from './invitation'
import { type MembershipListener, MembershipListeners } from './listeners'
import { OrganisationRemoval } from './removal'
import { MembershipTurns } from './turns'

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
 * them, and the listeners hear the lists in that order. An invite, a removal and a departure run
 * in the turn of each organisation they change too (`MembershipTurns`), and decide there from
 * the rows as they are then: an invite or a removal is refused when its organisation is gone or
 * its admin no longer one, a departure when it would leave the others without an admin. This
 * orders them within one gateway process only; gateways running in several processes would need
 * a durable revision of the memberships.
 */
export class Organisations {
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers
  readonly #listeners: MembershipListeners
  readonly #creation: OrganisationCreation
  readonly #invitation: OrganisationInvitation
  readonly #removal: OrganisationRemoval
  readonly #departure: AccountDeparture
  readonly #turns = new MembershipTurns()

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

    return this.#turns.ofIdentity(identity, () =>
      this.#creation
        .create(identity, key, name)
        .andThen((tenant) =>
          this.#listeners.tell(identity).map((): Membership => ({ tenant, role: 'admin' })),
        ),
    )
  }

  /**
   * An admin of the organisation adds the identity that signs in with `email` as a member
   * (`OrganisationInvitation`), and the invited identity's listeners hear it. In the identity's
   * turn the email is looked up again: an identity whose account went while the invite waited for
   * its departure (`leaveAll`), or whose email names another identity now, is refused
   * `no-such-identity`, so no membership is written for an identity that is gone.
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
        this.#turns.ofIdentity(identity.id, () =>
          this.#lookup
            .identityByEmail(email)
            .andThen((current) =>
              current.id === identity.id ? okAsync(tenant) : errAsync(refused('no-such-identity')),
            )
            .andThen(() =>
              this.#asAdmin(actor, tenant, (current) =>
                this.#invitation
                  .admit(current, identity.id)
                  .andThen(() => this.#listeners.tell(identity.id))
                  .map((): Member => ({ identity, role: 'member' })),
              ),
            ),
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
      .andThen((tenant) =>
        this.#turns.ofIdentity(identity, () =>
          this.#asAdmin(actor, tenant, (current) => this.#removal.remove(current, identity)),
        ),
      )
  }

  /**
   * Takes `identity`, whose account goes, out of every organisation (`AccountDeparture.leave`)
   * in its turn and the turns of its organisations: an invite of it asked meanwhile waits for it,
   * and so does a change of another identity in one of them. Refused `last-admin`, changing
   * nothing, while it is the only admin of a ready organisation with others in it. Once it left,
   * `then` runs while those turns are still held, so what follows the departure (the removal of
   * the account's own rows) ends before an invite of it can write anything; its failure is the
   * answer, and nothing runs it after a refusal. It revokes no region and tells nobody: the caller
   * closes the identity's connections beforehand.
   */
  leaveAll(
    identity: IdentityId,
    then: () => ResultAsync<void, DataError> = () => okAsync(undefined),
  ): ResultAsync<void, DepartureError> {
    return this.#turns.ofIdentity(identity, () =>
      this.#departure
        .organisationsOf(identity)
        .andThen((tenants) =>
          this.#turns.ofTenants(tenants, () => this.#departure.leave(identity).andThen(then)),
        ),
    )
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
   * Runs `work`, a change of the organisation's memberships `actor` asked, in the organisation's
   * turn, once it found that the organisation is still the one asked of and `actor` still one of
   * its admins: a change that settled meanwhile (a departure that took the organisation whole,
   * or `actor` out of it) refuses it as the checks before the turn would have.
   */
  #asAdmin<T>(
    actor: IdentityId,
    tenant: Tenant,
    work: (tenant: Tenant) => ResultAsync<T, OrganisationError>,
  ): ResultAsync<T, OrganisationError> {
    return this.#turns.ofTenants([tenant.id], () =>
      this.#lookup
        .tenantOf(tenant.key)
        .andThen((current) =>
          current.id === tenant.id
            ? this.#lookup.adminOf(actor, current)
            : errAsync(refused('no-such-tenant')),
        )
        .andThen(work),
    )
  }
}
