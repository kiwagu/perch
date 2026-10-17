import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

/** A member of an organisation, as the gateway lists and invites them. */
export interface MemberView {
  readonly identity: { readonly id: IdentityId; readonly email: string }
  readonly role: TenantRole
}

/**
 * The organisations of the signed-in identity at the gateway: creating one makes the identity
 * its admin and a member of it on this device at once; an admin lists, invites and removes the
 * members, whose own devices hear of it from the gateway.
 */
export interface OrganisationsPort {
  create(input: { key: string; name: string }): ResultAsync<Membership, DataError>
  members(key: string): ResultAsync<readonly MemberView[], DataError>
  invite(key: string, email: string): ResultAsync<MemberView, DataError>
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError>
}

export const ORGANISATIONS = token<OrganisationsPort>('Organisations')
