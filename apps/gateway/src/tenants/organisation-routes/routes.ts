import { match } from 'ts-pattern'

import type { AuthSessions } from '../../auth/auth-sessions'
import { bearerCaller, bearerRefused } from '../../auth/bearer-caller'
import { badRequest, errorAnswer, type Handler } from '../organisation-http'
import type { Organisations } from '../organisations'

import { invitationHandlers } from './invitation-handlers'
import { membershipHandlers } from './membership-handlers'
import type { OrganisationRoutesOptions } from './options'
import { type Target, targetOf } from './targets'

/**
 * The organisation routes over HTTP, for the identity whose live session the device's token holds
 * (`Authorization: Bearer <token>`, the raw session token) on the device it names in
 * `X-Perch-Device`, which must be the device the session was opened on.
 *
 * - `GET /organisations`: 200 `{ memberships }`.
 * - `POST /organisations` `{ key, name }`: 201 `{ membership }`, with the caller as admin; 10 an
 *   hour per identity and 30 per client address. A caller whose account was deleted while the
 *   creation waited for it answers 401 `unauthorized`, as a token that holds no session does,
 *   and nothing is created.
 * - `GET /organisations/:key/members`: 200 `{ members }`, for an admin (a member gets 403
 *   `not-admin`).
 * - `PATCH /organisations/:key/members/:identity` `{ role }`: 204, for an admin; `last-admin`
 *   (409) for the only admin's demotion, `no-such-member` (404) for one who is no member.
 * - `DELETE /organisations/:key/members/:identity`: 204, for an admin.
 * - `POST /organisations/:key/invitations` `{ email, role }`: 201 `{ invitation: { id, email,
 *   role, link } }`, for an admin, an email with an account and one without answered alike and
 *   neither sooner than `INVITE_FLOOR_MS` after the request began; `email-invalid` (400) for an
 *   email the gateway does not take, `already-member` (409) for a member's. An attempt takes one
 *   of the client address's mails, one of the inviting identity's 30 invites per 10 minutes and
 *   one of the address's 60, counted once the body follows its schema, whatever the answer.
 * - `GET /organisations/:key/invitations`: 200 `{ invitations }`, newest first, for an admin.
 * - `DELETE /organisations/:key/invitations/:invitation`: 204, for an admin, also for an
 *   invitation that is gone or belongs to another organisation (which it leaves alone).
 *
 * A method a path does not take answers 405 with the ones it does in `Allow` (the direct add of a
 * member, `POST /organisations/:key/members`, is gone: only `GET` is left there); a request whose
 * token holds no live session, or one of another device, 401 `unauthorized`; a request that
 * names no device, or a body or an identity or an invitation id that does not follow its schema,
 * 400 `bad-request`; a refusal, its code with 400, 403, 404 or 409; a limit, 429 `rate-limited`
 * with `Retry-After`, before the service is asked and counted only once the body follows its
 * schema; a failure of the gateway, 500 `internal`, the failure itself handed to `onFailure`. A
 * request for another path is not answered here (`undefined`), so the server can try its other
 * routes.
 */
export function organisationRoutes(
  sessions: Pick<AuthSessions, 'read'>,
  organisations: Organisations,
  options: OrganisationRoutesOptions,
): (request: Request, from: string) => Promise<Response | undefined> {
  const errorResponse = errorAnswer(options.onFailure)
  const memberships = membershipHandlers(organisations, options)
  const invitations = invitationHandlers(organisations, options)

  /** The methods the target takes, each with its handler, in the order `Allow` lists them. */
  function handlersOf(target: Target): ReadonlyMap<string, Handler> {
    return match(target)
      .with(
        { kind: 'organisations' },
        () =>
          new Map([
            ['GET', memberships.list],
            ['POST', memberships.create],
          ]),
      )
      .with({ kind: 'members' }, ({ key }) => new Map([['GET', memberships.members(key)]]))
      .with(
        { kind: 'member' },
        ({ key, identity }) =>
          new Map([
            ['PATCH', memberships.setRole(key, identity)],
            ['DELETE', memberships.remove(key, identity)],
          ]),
      )
      .with(
        { kind: 'invitations' },
        ({ key }) =>
          new Map([
            ['GET', invitations.pending(key)],
            ['POST', invitations.invite(key)],
          ]),
      )
      .with(
        { kind: 'invitation' },
        ({ key, invitation }) => new Map([['DELETE', invitations.revoke(key, invitation)]]),
      )
      .exhaustive()
  }

  return async (request, from) => {
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

    const caller = await bearerCaller(sessions, request)

    return match(caller)
      .with({ kind: 'caller' }, ({ identity }) => handler(identity, request, from))
      .with({ kind: 'unauthorized' }, async () => bearerRefused())
      .with({ kind: 'bad-request' }, async () => badRequest())
      .with({ kind: 'failed' }, async ({ error }) => errorResponse(error))
      .exhaustive()
  }
}
