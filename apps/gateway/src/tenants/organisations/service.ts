import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import { AccountDeparture, type DepartureError, type DepartureSteps } from '../account-departure'
import { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import type { Member } from '../organisation-rows'
import { TenantMembers } from '../tenant-members'

import { AdminTurn } from './admin-turn'
import { OrganisationAdmission } from './admission'
import { OrganisationCreation } from './creation'
import { OrganisationInvitations } from './invitations'
import { type MembershipListener, MembershipListeners } from './listeners'
import type { OrganisationsOptions } from './options'
import { OrganisationRemoval } from './removal'
import { OrganisationRoleChange } from './role-change'
import { MembershipTurns } from './turns'

/** The longest name an organisation may have, in characters. */
const MAX_NAME = 80

/**
 * The organisations of the application and who belongs to them. The directory holds each
 * organisation and every membership; each organisation's own database holds its members, the
 * word its data is checked against. A command that fails with a `DataError` after some of its
 * rows were written leaves those rows in place, and asking again completes it: a creation by its
 * creator, a role change, a removal. Each change of memberships but a departure resolves once
 * its tell settled: the listeners heard the identity's new memberships, or the telling failed
 * and is retold later (`MembershipListeners`); no change fails for the telling.
 *
 * The changes of one identity's memberships (its creations, its acceptances of invitations, its
 * role changes, its removals and its departure) run one after the other, each once the one before
 * it, its notification included, has settled: the directory and the organisation's database end
 * as the last one left them, and the listeners hear the lists in that order. An acceptance, a
 * role change, a removal and a departure run in the turn of each organisation they change too
 * (`MembershipTurns`; `AdminTurn` for those an admin asks), and decide there from the rows as they
 * are then: a role change or a removal is refused when its organisation is gone or its admin no
 * longer one, a departure or a demotion when it would leave the others without an admin. This
 * orders them within one gateway process only; gateways running in several processes would need
 * a durable revision of the memberships.
 *
 * The invitations to join an organisation are `invitations` (`OrganisationInvitations`): they
 * share the turns, the lookup, the listeners and the admission of this class, so an accepted
 * invitation is a change of memberships like any other.
 */
export class Organisations {
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers
  readonly #listeners: MembershipListeners
  readonly #creation: OrganisationCreation
  readonly #roleChange: OrganisationRoleChange
  readonly #removal: OrganisationRemoval
  readonly #departure: AccountDeparture
  readonly #turns = new MembershipTurns()
  readonly #adminTurn: AdminTurn
  /** The invitations of organisations: invited, revoked, read, accepted and declined. */
  readonly invitations: OrganisationInvitations

  constructor(options: OrganisationsOptions) {
    const { directory, databases, revoke, rerole, hub } = options
    const lookup = new OrganisationLookup(directory)
    const members = new TenantMembers(databases)
    const listeners = new MembershipListeners(lookup, this.#turns, options.retell)
    const admission = new OrganisationAdmission({ directory, lookup, members })

    this.#adminTurn = new AdminTurn(this.#turns, lookup)
    this.#lookup = lookup
    this.#members = members
    this.#listeners = listeners
    this.#creation = new OrganisationCreation({ directory, databases, lookup, members })
    this.invitations = new OrganisationInvitations({
      ...options.invitations,
      lookup,
      turns: this.#turns,
      adminTurn: this.#adminTurn,
      admission,
      listeners,
    })
    this.#roleChange = new OrganisationRoleChange({ directory, lookup, members, rerole })
    this.#removal = new OrganisationRemoval({ directory, members, listeners, revoke })
    this.#departure = new AccountDeparture({ directory, databases, hub })
  }

  /** The ready organisations `identity` belongs to, with its role in each, by key. */
  membershipsOf(identity: IdentityId): ResultAsync<readonly Membership[], DataError> {
    return this.#lookup.membershipsOf(identity)
  }

  /**
   * Creates an organisation with `identity` as its admin (`OrganisationCreation`), once its name
   * is trimmed, and tells the creator's listeners. In the identity's turn the identity is read
   * again first: one whose account went while the creation waited for its departure (`leaveAll`)
   * is refused `no-such-identity`, and nothing is provisioned for it.
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
      this.#lookup
        .existing(identity)
        .andThen(() => this.#creation.create(identity, key, name))
        .andThen((tenant) =>
          this.#listeners.tell(identity).map((): Membership => ({ tenant, role: 'admin' })),
        ),
    )
  }

  /**
   * An admin of the organisation sets the role of `identity` in it (`OrganisationRoleChange`), and
   * the identity's listeners hear it, in the identity's turn and the organisation's: decided from
   * the rows as they are in that turn, so two admins demoting each other at once leave one admin
   * (the second is no admin by its turn and is refused `not-admin`), and a demotion races a
   * departure without leaving the organisation none (`last-admin`, which first writes the member
   * row of the only admin again as the directory has it). Asking again completes a change that
   * failed; a failure of the telling alone fails nothing and is retold.
   */
  setRole(input: {
    actor: IdentityId
    key: string
    identity: IdentityId
    role: TenantRole
  }): ResultAsync<void, OrganisationError> {
    const { actor, key, identity, role } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) =>
        this.#turns.ofIdentity(identity, () =>
          this.#adminTurn.run(actor, tenant, (current) =>
            this.#roleChange
              .set(current, identity, role)
              .andThen(() => this.#listeners.tell(identity)),
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
          this.#adminTurn.run(actor, tenant, (current) => this.#removal.remove(current, identity)),
        ),
      )
  }

  /**
   * Takes `identity`, whose account goes, out of every organisation (`AccountDeparture.leave`)
   * in its turn and the turns of its organisations: an invite of it, a creation by it, and a
   * change of another identity in one of them, asked meanwhile, wait for it. Refused `last-admin`,
   * changing nothing, while it is the only admin of a ready organisation with others in it: that
   * check is the one that decides, made from the rows as they are in those turns. `steps` run in
   * the same turns (`DepartureSteps`): `before` once the departure was found allowed, ahead of
   * every write, so what must not happen to an identity that stays (ending its sessions, spending
   * a link) happens only when it leaves, and its stop changes nothing; `after` once it left, so
   * what follows the departure (the removal of the account's own rows) ends before an invite of
   * it can write anything. It answers what `before` answers. It revokes no region and tells
   * nobody: the caller closes the identity's connections.
   */
  leaveAll(identity: IdentityId): ResultAsync<void, DepartureError>
  leaveAll<T, Stop>(
    identity: IdentityId,
    steps: DepartureSteps<T, Stop>,
  ): ResultAsync<T, DepartureError | Stop>
  leaveAll<T, Stop>(
    identity: IdentityId,
    steps?: DepartureSteps<T, Stop>,
  ): ResultAsync<T | undefined, DepartureError | Stop> {
    const before = steps?.before ?? (() => okAsync(undefined))
    const after = steps?.after ?? (() => okAsync(undefined))

    return this.#turns.ofIdentity(identity, () =>
      this.#departure
        .organisationsOf(identity)
        .andThen((tenants) =>
          this.#turns.ofTenants(tenants, () =>
            this.#departure
              .leave<T | undefined, Stop>(identity, before)
              .andThen((value) => after().map(() => value)),
          ),
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
   * Stops the re-tells of failed tells for good, and resolves once the one running, if any,
   * settled; the changes under way are not waited for. Closed before what the re-tells read and
   * tell.
   */
  close(): Promise<void> {
    return this.#listeners.close()
  }
}
