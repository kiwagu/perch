import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { IdentityId, InvitationId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

/** A member of an organisation, as the gateway lists them. */
export interface MemberView {
  readonly identity: { readonly id: IdentityId; readonly email: string }
  readonly role: TenantRole
}

/** A pending invitation of an organisation, with the link its mail carries. */
export interface InvitationView {
  readonly id: InvitationId
  readonly email: string
  readonly role: TenantRole
  readonly link: string
}

/**
 * The organisations of the signed-in identity at the gateway: creating one makes the identity
 * its admin and a member of it on this device at once; an admin lists the members, invites an
 * email with a role, lists and revokes the pending invitations, changes a member's role and
 * removes a member. Those changes reach the members' own devices, this one's included, from the
 * gateway.
 */
export interface OrganisationsPort {
  create(input: { key: string; name: string }): ResultAsync<Membership, DataError>
  members(key: string): ResultAsync<readonly MemberView[], DataError>
  invite(key: string, email: string, role: TenantRole): ResultAsync<InvitationView, DataError>
  invitations(key: string): ResultAsync<readonly InvitationView[], DataError>
  revokeInvitation(key: string, invitation: InvitationId): ResultAsync<void, DataError>
  setRole(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, DataError>
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError>
}

export const ORGANISATIONS = token<OrganisationsPort>('Organisations')
