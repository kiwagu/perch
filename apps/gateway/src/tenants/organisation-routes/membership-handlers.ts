import { idSchemas } from '@workspace/ids'
import { tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { newOrganisationOf } from '../new-organisation'
import { badRequest, callerErrorAnswer, errorAnswer, type Handler } from '../organisation-http'
import { refused } from '../organisation-refusal'
import type { Organisations } from '../organisations'

import type { OrganisationRoutesOptions } from './options'

/** What a device sends to create an organisation: its key and its name, judged by their rules below. */
const createBody = z.object({ key: z.string(), name: z.string() })

/** What an admin sends to change a member's role. */
const roleBody = z.object({ role: tenantRole })

/**
 * The handlers of the memberships of the signed-in identity (its list, a creation) and of the
 * members of an organisation (its list, a role change, a removal), each for the identity whose
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

    // A key or a name that breaks its rule is refused before the attempt is counted.
    const organisation = newOrganisationOf(body.data)

    if (organisation.isErr()) {
      return errorResponse(refused(organisation.error))
    }

    const allowance = options.limits.createOrganisation(identity, from)

    if (!allowance.allowed) {
      return tooMany(allowance)
    }

    // The identity goes last: it is the one whose session the token holds, whatever the body holds.
    return (await organisations.create({ ...organisation.value, identity })).match(
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

  const setRole =
    (key: string, member: string): Handler =>
    async (actor, request) => {
      const identity = idSchemas.identity.schema.safeParse(member)
      const body = roleBody.safeParse(await readBody(request))

      if (!identity.success || !body.success) {
        return badRequest()
      }

      return (
        await organisations.setRole({
          actor,
          key,
          identity: identity.data,
          role: body.data.role,
        })
      ).match(() => new Response(null, { status: 204 }), errorResponse)
    }

  return { list, create, members, remove, setRole }
}
