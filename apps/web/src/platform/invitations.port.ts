import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { InvitationId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

/**
 * What the link of an invitation shows: the organisation's name, the role and whether the
 * invitation is for the account signed in on this device. Never the invited email.
 */
export interface InvitationOnLink {
  readonly organisation: { readonly name: string }
  readonly role: TenantRole
  readonly forYou: boolean
}

/** An invitation to the signed-in account's email, as the gateway lists it. */
export interface ReceivedInvitation {
  readonly id: InvitationId
  readonly organisation: { readonly name: string }
  readonly role: TenantRole
}

/**
 * The invitations at the gateway: reading what a link carries (signed in or not), the invitations
 * to the signed-in account, and accepting or declining one by its id or the token of its link.
 * Accepting makes the account a member of the organisation on this device at once.
 */
export interface InvitationsPort {
  read(token: string): ResultAsync<InvitationOnLink, DataError>
  mine(): ResultAsync<readonly ReceivedInvitation[], DataError>
  accept(invitation: string): ResultAsync<Membership, DataError>
  decline(invitation: string): ResultAsync<void, DataError>
}

export const INVITATIONS = token<InvitationsPort>('Invitations')
