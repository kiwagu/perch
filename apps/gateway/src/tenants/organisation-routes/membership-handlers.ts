import { idSchemas } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { accountEmail } from '../../auth/account-email'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { badRequest, callerErrorAnswer, errorAnswer, type Handler } from '../organisation-http'
import type { Organisations } from '../organisations'

import type { OrganisationRoutesOptions } from './options'

/** What a device sends to create an organisation. */
const createBody = z.object({
  key: z.string().refine(isTenantKey),
  name: z.string().trim().min(1).max(80),
})

/** What an admin sends to invite an identity into an organisation. */
const inviteBody = z.object({ email: accountEmail })

/**
 * The handlers of the memberships of the signed-in identity (its list, a creation) and of the
 * members of an organisation (its list, an invite, a removal), each for the identity whose
 * session the request carries.
 */
export function membershipHandlers(
  organisations: Organisations,
  options: OrganisationRoutesOptions,
) {
  const errorResponse = errorAnswer(options.onFailure)

  const list: Handler = async (identity) =>
    (await organisations.membershipsOf(identity)).match(
      (memberships) => Response.json({ memberships }),
      errorResponse,
    )

  const create: Handler = async (identity, request, from) => {
    const body = createBody.safeParse(await readBody(request))

    if (!body.success) {
      return badRequest()
    }

    const allowance = options.limits.createOrganisation(identity, from)

    if (!allowance.allowed) {
      return tooMany(allowance)
    }

    // The identity goes last: it is the one whose session the token holds, whatever the body holds.
    return (await organisations.create({ ...body.data, identity })).match(
      (membership) => Response.json({ membership }, { status: 201 }),
      callerErrorAnswer(options.onFailure),
    )
  }

  const members =
    (key: string): Handler =>
    async (actor) =>
      (await organisations.membersOf({ actor, key })).match(
        (found) => Response.json({ members: found }),
        errorResponse,
      )

  const invite =
    (key: string): Handler =>
    async (actor, request, from) => {
      const body = inviteBody.safeParse(await readBody(request))

      if (!body.success) {
        return badRequest()
      }

      const allowance = options.limits.invite(actor, from)

      if (!allowance.allowed) {
        return tooMany(allowance)
      }

      return (await organisations.invite({ actor, key, email: body.data.email })).match(
        (member) => Response.json({ member }),
        errorResponse,
      )
    }

  const remove =
    (key: string, member: string): Handler =>
    async (actor) => {
      const identity = idSchemas.identity.schema.safeParse(member)

      if (!identity.success) {
        return badRequest()
      }

      return (await organisations.remove({ actor, key, identity: identity.data })).match(
        () => new Response(null, { status: 204 }),
        errorResponse,
      )
    }

  return { list, create, members, invite, remove }
}
