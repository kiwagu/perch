/**
 * The gateway's organisation routes over HTTP, called with the device's session token and its
 * id (`X-Perch-Device`).
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { type IdentityId, type InvitationId, idSchemas } from '@workspace/ids'
import {
  type Membership,
  membership,
  type TenantRole,
  tenantRole,
} from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { InvitationView, MemberView } from '../platform/organisations.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'

export interface OrganisationsApi {
  list(): ResultAsync<readonly Membership[], DataError>
  create(input: { key: string; name: string }): ResultAsync<Membership, DataError>
  members(key: string): ResultAsync<readonly MemberView[], DataError>
  invite(key: string, email: string, role: TenantRole): ResultAsync<InvitationView, DataError>
  invitations(key: string): ResultAsync<readonly InvitationView[], DataError>
  revokeInvitation(key: string, invitation: InvitationId): ResultAsync<void, DataError>
  setRole(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, DataError>
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError>
}

const memberView = z.object({
  identity: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  role: tenantRole,
})

const invitationView = z.object({
  id: idSchemas.invitation.schema,
  email: z.string(),
  role: tenantRole,
  link: z.string(),
})

/**
 * The gateway's `/organisations` routes under `baseUrl`: the members (`/members`, a role changed
 * by a PATCH of one) and the invitations (`/invitations`: an invite is a POST there, never to
 * the members).
 */
export function organisationsApi(baseUrl: string, deps: BearerDeps): OrganisationsApi {
  const calls = bearerCalls(baseUrl, deps)
  const organisation = (key: string) => `/organisations/${encodeURIComponent(key)}`
  const base = (key: string) => `${organisation(key)}/members`
  const invitationsOf = (key: string) => `${organisation(key)}/invitations`

  return {
    list: () =>
      calls
        .json('/organisations', 'GET', z.object({ memberships: z.array(membership) }))
        .map((answer) => answer.memberships),
    create: (input) =>
      calls
        .json('/organisations', 'POST', z.object({ membership }), input)
        .map((answer) => answer.membership),
    members: (key) =>
      calls
        .json(base(key), 'GET', z.object({ members: z.array(memberView) }))
        .map((answer) => answer.members),
    invite: (key, email, role) =>
      calls
        .json(invitationsOf(key), 'POST', z.object({ invitation: invitationView }), { email, role })
        .map((answer) => answer.invitation),
    invitations: (key) =>
      calls
        .json(invitationsOf(key), 'GET', z.object({ invitations: z.array(invitationView) }))
        .map((answer) => answer.invitations),
    revokeInvitation: (key, invitation) =>
      calls.empty(`${invitationsOf(key)}/${encodeURIComponent(invitation)}`, 'DELETE'),
    setRole: (key, identity, role) =>
      calls.empty(`${base(key)}/${encodeURIComponent(identity)}`, 'PATCH', { role }),
    remove: (key, identity) =>
      calls.empty(`${base(key)}/${encodeURIComponent(identity)}`, 'DELETE'),
  }
}
