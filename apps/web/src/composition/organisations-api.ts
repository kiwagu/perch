/**
 * The gateway's organisation routes over HTTP, called with the device's access token and its
 * id (`X-Perch-Device`). A refused token is renewed once through the sync leader and the call
 * is made again.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { type Membership, membership, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { MemberView } from '../platform/organisations.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'

export interface OrganisationsApi {
  list(): ResultAsync<readonly Membership[], DataError>
  create(input: { key: string; name: string }): ResultAsync<Membership, DataError>
  members(key: string): ResultAsync<readonly MemberView[], DataError>
  invite(key: string, email: string): ResultAsync<MemberView, DataError>
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError>
}

const memberView = z.object({
  identity: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  role: tenantRole,
})

/** The gateway's `/organisations` routes under `baseUrl`. */
export function organisationsApi(baseUrl: string, deps: BearerDeps): OrganisationsApi {
  const calls = bearerCalls(baseUrl, deps)
  const base = (key: string) => `/organisations/${encodeURIComponent(key)}/members`

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
    invite: (key, email) =>
      calls
        .json(base(key), 'POST', z.object({ member: memberView }), { email })
        .map((answer) => answer.member),
    remove: (key, identity) =>
      calls.empty(`${base(key)}/${encodeURIComponent(identity)}`, 'DELETE'),
  }
}
