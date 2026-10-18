import { match, P } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { isTenantKey, TENANT_KEY_PATTERN } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { bearerIdentity, readBody } from '../auth/auth.routes'
import type { IdentitySessions } from '../auth/identity-sessions'

import type { OrganisationError, OrganisationRefusalCode, Organisations } from './organisations'

/** What a device sends to create an organisation. */
const createBody = z.object({
  key: z.string().refine(isTenantKey),
  name: z.string().trim().min(1).max(80),
})

/** What an admin sends to invite an identity into an organisation. */
const inviteBody = z.object({ email: z.email() })

/** An organisation's key in a path: the kernel's key rule without its anchors. */
const KEY = TENANT_KEY_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '')

/**
 * The organisation paths: every organisation, an organisation's members, one of its members. A
 * key outside the rule makes a path that is not the organisations' own.
 */
const PATH = new RegExp(`^/organisations(?:/(${KEY})(?:/members(?:/([^/]+))?)?)?$`)

/** What a path names. */
type Target =
  | { readonly kind: 'organisations' }
  | { readonly kind: 'members'; readonly key: string }
  | { readonly kind: 'member'; readonly key: string; readonly identity: string }

/** Answers a request of the identity its access token signs in. */
type Handler = (identity: IdentityId, request: Request) => Promise<Response>

/** What `pathname` names; an organisation's own path (`/organisations/:key`) is not served. */
function targetOf(pathname: string): Target | undefined {
  const found = PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, key, identity] = found

  if (key === undefined) {
    return { kind: 'organisations' }
  }

  if (identity !== undefined) {
    return { kind: 'member', key, identity }
  }

  return pathname === `/organisations/${key}/members` ? { kind: 'members', key } : undefined
}

function statusOf(code: OrganisationRefusalCode): number {
  return match(code)
    .with(P.union('invalid-key', 'invalid-name'), () => 400)
    .with(P.union('not-a-member', 'not-admin'), () => 403)
    .with(P.union('no-such-tenant', 'no-such-identity'), () => 404)
    .with(P.union('key-taken', 'already-member', 'self'), () => 409)
    .exhaustive()
}

function badRequest(): Response {
  return Response.json({ code: 'bad-request' }, { status: 400 })
}

export interface OrganisationRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}

/**
 * The organisation routes over HTTP, for the identity the device's access token signs in
 * (`Authorization: Bearer <access>`). A refresh key is not taken here: a device whose access
 * token no longer works renews its pair first.
 *
 * - `GET /organisations`: 200 `{ memberships }`.
 * - `POST /organisations` `{ key, name }`: 201 `{ membership }`, with the caller as admin.
 * - `GET /organisations/:key/members`: 200 `{ members }`, for an admin (a member gets 403
 *   `not-admin`).
 * - `POST /organisations/:key/members` `{ email }`: 200 `{ member }`, for an admin.
 * - `DELETE /organisations/:key/members/:identity`: 204, for an admin.
 *
 * A method a path does not take answers 405 with the ones it does in `Allow`; a request whose
 * token signs nobody in, 401 `unauthorized`; a body or an identity that does not follow its
 * schema, 400 `bad-request`; a refusal, its code with 400, 403, 404 or 409; a failure of the
 * gateway, 500 `internal`, the failure itself handed to `onFailure`. A request for another path
 * is not answered here (`undefined`), so the server can try its other routes.
 */
export function organisationRoutes(
  sessions: Pick<IdentitySessions, 'authenticate'>,
  organisations: Organisations,
  options: OrganisationRoutesOptions,
): (request: Request) => Promise<Response | undefined> {
  /** A refusal answers its code; a failure of the gateway answers without its cause, which `onFailure` hears. */
  function errorResponse(error: OrganisationError): Response {
    if ('kind' in error) {
      return Response.json({ code: error.code }, { status: statusOf(error.code) })
    }

    options.onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }

  const list: Handler = async (identity) =>
    (await organisations.membershipsOf(identity)).match(
      (memberships) => Response.json({ memberships }),
      errorResponse,
    )

  const create: Handler = async (identity, request) => {
    const body = createBody.safeParse(await readBody(request))

    if (!body.success) {
      return badRequest()
    }

    // The identity goes last: it is the one the access token signs in, whatever the body holds.
    return (await organisations.create({ ...body.data, identity })).match(
      (membership) => Response.json({ membership }, { status: 201 }),
      errorResponse,
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
    async (actor, request) => {
      const body = inviteBody.safeParse(await readBody(request))

      if (!body.success) {
        return badRequest()
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

  /** The methods the target takes, each with its handler, in the order `Allow` lists them. */
  function handlersOf(target: Target): ReadonlyMap<string, Handler> {
    return match(target)
      .with(
        { kind: 'organisations' },
        () =>
          new Map([
            ['GET', list],
            ['POST', create],
          ]),
      )
      .with(
        { kind: 'members' },
        ({ key }) =>
          new Map([
            ['GET', members(key)],
            ['POST', invite(key)],
          ]),
      )
      .with({ kind: 'member' }, ({ key, identity }) => new Map([['DELETE', remove(key, identity)]]))
      .exhaustive()
  }

  return async (request) => {
    const target = targetOf(new URL(request.url).pathname)

    if (!target) {
      return undefined
    }

    const handlers = handlersOf(target)
    const handler = handlers.get(request.method)

    if (!handler) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: [...handlers.keys()].join(', ') } },
      )
    }

    const identity = await bearerIdentity(sessions, request)

    if (identity === undefined) {
      return Response.json({ code: 'unauthorized' }, { status: 401 })
    }

    return handler(identity, request)
  }
}
