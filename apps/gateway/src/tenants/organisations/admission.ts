import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, recordId } from '@workspace/data'
import { type IdentityId, membershipIdFactory } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import type { PendingInvitation } from '../invitations'
import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import { type Tenant, takenIn, writing } from '../organisation-rows'
import invitationAcceptStatement from '../surql/invitation-accept.surql'
import membershipAddStatement from '../surql/membership-add.surql'
import type { TenantMembers } from '../tenant-members'

export interface OrganisationAdmissionOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly lookup: OrganisationLookup
  readonly members: TenantMembers
}

/**
 * The rows that make an identity a member of an organisation with a role: its membership in the
 * directory and its member row in the organisation's database. It is the one way to add a member
 * with a role, whoever asks for it: `admit` writes the membership first, `accept` the member row
 * first.
 */
export class OrganisationAdmission {
  readonly #directory: LocalDb
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers

  constructor(options: OrganisationAdmissionOptions) {
    this.#directory = options.directory
    this.#lookup = options.lookup
    this.#members = options.members
  }

  /**
   * Writes the membership of `identity` in the organisation with `role`, then its member row. An
   * identity already in is refused, once its member row is written again with the role the
   * directory holds (not `role`): asking again completes an admission that failed after the
   * membership.
   */
  admit(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return this.#join(tenant, identity, role).andThen(() =>
      this.#members.add(tenant.key, identity, role),
    )
  }

  /**
   * `identity` accepts `invitation` to the organisation: its member row with the role of the
   * invitation, then one directory transaction that writes its membership with that role and
   * spends the invitation. The member row goes first, so a failure after it leaves the invitation
   * live and asking again completes the admission; a membership written before a member row that
   * then failed would leave a member no list shows and no reconnection repairs, the invitation
   * being spent. An identity that is a member already is refused `already-member`, once its member
   * row is written again with the role the directory holds (not the invitation's), and the
   * invitation stays.
   */
  accept(
    tenant: Tenant,
    identity: IdentityId,
    invitation: Pick<PendingInvitation, 'id' | 'role'>,
  ): ResultAsync<void, OrganisationError> {
    return this.#lookup
      .roleOf(tenant, identity)
      .andThen((held) =>
        held === undefined
          ? this.#members
              .add(tenant.key, identity, invitation.role)
              .andThen(() => this.#joinAndSpend(tenant, identity, invitation))
          : this.#alreadyMember(tenant, identity),
      )
  }

  /**
   * The directory's membership of `identity` in the organisation with `role`; one it already has
   * is refused once its member row is restored.
   */
  #join(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return writing(
      this.#directory.db
        .query(membershipAddStatement, {
          id: membershipIdFactory.create(),
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
          role,
        })
        .retry(),
      `could not add the membership of ${identity} in ${tenant.key}`,
    )
      .map(() => undefined)
      .orElse((error) =>
        takenIn('membership_identity_tenant', error)
          ? this.#alreadyMember(tenant, identity)
          : errAsync(error),
      )
  }

  /**
   * The directory's membership of `identity` with the role of `invitation`, and the invitation
   * spent, in one transaction; a membership it already has refuses it whole, once its member row
   * is restored.
   */
  #joinAndSpend(
    tenant: Tenant,
    identity: IdentityId,
    invitation: Pick<PendingInvitation, 'id' | 'role'>,
  ): ResultAsync<void, OrganisationError> {
    return writing(
      this.#directory.db
        .query(invitationAcceptStatement, {
          id: membershipIdFactory.create(),
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
          role: invitation.role,
          invitation: invitation.id,
        })
        .retry(),
      `could not add the membership of ${identity} in ${tenant.key} for its invitation`,
    )
      .map(() => undefined)
      .orElse((error) =>
        takenIn('membership_identity_tenant', error)
          ? this.#alreadyMember(tenant, identity)
          : errAsync(error),
      )
  }

  /** Refuses `already-member`, once the member row of `identity` is written again as the directory has it. */
  #alreadyMember(tenant: Tenant, identity: IdentityId): ResultAsync<void, OrganisationError> {
    return this.#restoreMember(tenant, identity).andThen(() =>
      errAsync<void, OrganisationError>(refused('already-member')),
    )
  }

  /**
   * Writes the member row of an identity the directory already counts in the organisation, with
   * the role the directory holds; nothing when its membership is gone.
   */
  #restoreMember(tenant: Tenant, identity: IdentityId): ResultAsync<void, DataError> {
    return this.#lookup
      .roleOf(tenant, identity)
      .andThen((role) =>
        role === undefined ? okAsync(undefined) : this.#members.add(tenant.key, identity, role),
      )
  }
}
