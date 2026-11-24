import { idSchemas } from '@workspace/ids'
import { tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { accountEmail } from '../../auth/account-email'
import { until } from '../../floor'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { badRequest, errorAnswer, type Handler } from '../organisation-http'
import { refused } from '../organisation-refusal'
import type { Organisations } from '../organisations'

import type { OrganisationRoutesOptions } from './options'

/**
 * The least time an invite that was accepted takes to answer, counted from when its handler
 * began: an email with an account and one without are answered in the same time, as long as the
 * invite's own work (two lookups, one transaction, one signature, a mail started, no password to
 * check) stays under it. A refusal needs none: `already-member` tells an admin what the members
 * list shows.
 */
export const INVITE_FLOOR_MS = 300

/** What an admin sends to invite an email: the email is judged after the attempt was counted. */
const inviteBody = z.object({ email: z.string(), role: tenantRole })

/**
 * The handlers of the invitations of an organisation (their list, an invite, a revocation), each
 * for the admin whose session the request carries.
 */
export function invitationHandlers(
  organisations: Organisations,
  options: OrganisationRoutesOptions,
) {
  const errorResponse = errorAnswer(options.onFailure)

  const pending =
    (key: string): Handler =>
    async (actor) =>
      (await organisations.invitations.pending({ actor, key })).match(
        (invitations) => Response.json({ invitations }),
        errorResponse,
      )

  const invite =
    (key: string): Handler =>
    async (actor, request, from) => {
      const started = options.clock.now()
      const body = inviteBody.safeParse(await readBody(request))

      if (!body.success) {
        return badRequest()
      }

      // Every attempt counts once its body follows the schema, an email nobody takes included.
      const allowance = options.limits.inviteMail(actor, from)

      if (!allowance.allowed) {
        return tooMany(allowance)
      }

      const email = accountEmail.safeParse(body.data.email)

      if (!email.success) {
        return errorResponse(refused('email-invalid'))
      }

      const invited = await organisations.invitations.invite({
        actor,
        key,
        email: email.data,
        role: body.data.role,
      })

      if (invited.isErr()) {
        return errorResponse(invited.error)
      }

      await until(options.clock, started + INVITE_FLOOR_MS)

      return Response.json({ invitation: invited.value }, { status: 201 })
    }

  const revoke =
    (key: string, invitation: string): Handler =>
    async (actor) => {
      const id = idSchemas.invitation.schema.safeParse(invitation)

      if (!id.success) {
        return badRequest()
      }

      return (await organisations.invitations.revoke({ actor, key, invitation: id.data })).match(
        () => new Response(null, { status: 204 }),
        errorResponse,
      )
    }

  return { pending, invite, revoke }
}
