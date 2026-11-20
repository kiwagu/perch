/**
 * The gateway's invitation routes over HTTP: reading what a link carries needs no session, the
 * rest act for the signed-in device with its session token and its id (`X-Perch-Device`).
 */

import { idSchemas } from '@workspace/ids'
import { membership, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { InvitationsPort } from '../platform/invitations.port'

import { type BearerDeps, bearerCalls } from './gateway-bearer'

const onLink = z.object({
  invitation: z.object({
    organisation: z.object({ name: z.string() }),
    role: tenantRole,
    forYou: z.boolean(),
  }),
})

const received = z.object({
  id: idSchemas.invitation.schema,
  organisation: z.object({ name: z.string() }),
  role: tenantRole,
})

/**
 * `POST <baseUrl>/invitations/read` (the link's token in the body, never in the path, with the
 * device's session if it holds one), `GET /invitations`, `POST /invitations/accept` and
 * `POST /invitations/decline`. A refusal fails as `data:WRITE_REJECTED` with the gateway's code
 * (`link-invalid`, `link-expired`, `other-account`, `already-member`, `invitation-gone`,
 * `rate-limited`); any other answer but success names its status only.
 */
export function invitationsApi(baseUrl: string, deps: BearerDeps): InvitationsPort {
  const calls = bearerCalls(baseUrl, deps)

  return {
    read: (token) =>
      calls
        .jsonAsWhoever('/invitations/read', 'POST', onLink, { token })
        .map((answer) => answer.invitation),
    mine: () =>
      calls
        .json('/invitations', 'GET', z.object({ invitations: z.array(received) }))
        .map((answer) => answer.invitations),
    accept: (invitation) =>
      calls
        .json('/invitations/accept', 'POST', z.object({ membership }), { invitation })
        .map((answer) => answer.membership),
    decline: (invitation) => calls.empty('/invitations/decline', 'POST', { invitation }),
  }
}
