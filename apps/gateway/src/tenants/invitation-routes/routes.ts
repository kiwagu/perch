import { match } from 'ts-pattern'

import { z } from '@workspace/zod'

import type { AuthSessions } from '../../auth/auth-sessions'
import { bearerCaller, bearerRefused, bearerToken } from '../../auth/bearer-caller'
import type { RequestLimits } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import {
  badRequest,
  callerErrorAnswer,
  errorAnswer,
  type FailureListener,
  type Handler,
} from '../organisation-http'
import type { Organisations } from '../organisations'

/** The longest value of a token or an invitation the routes read: far above a signed token. */
const MAX_VALUE = 4096

/** What a reader of an invitation's link sends: the link's token. */
const readBodySchema = z.object({ token: z.string().min(1).max(MAX_VALUE) })

/** What an account sends to accept or decline: an invitation's id, or its link's token. */
const answerBody = z.object({ invitation: z.string().min(1).max(MAX_VALUE) })

export interface InvitationRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: FailureListener
  /** The limit of the reads of an invitation's link. */
  readonly limits: Pick<RequestLimits, 'invitationLink'>
}

/**
 * The invitation routes over HTTP. A token travels in a body, never in a path, which the server
 * logs.
 *
 * - `POST /invitations/read` `{ token }`: 200 `{ invitation: { organisation: { name }, role,
 *   forYou } }`, for a guest (no `Authorization`) or a signed-in account (`forYou` when it is the
 *   invited one); 404 `link-invalid` for a link that names nothing, 410 `link-expired` for one a
 *   week old; 20 per client address in 10 minutes, taken before the body is read, so a refused
 *   read costs the same whatever the token. A token that holds no live session is 401.
 * - `GET /invitations`: 200 `{ invitations }`, the signed-in account's, newest first.
 * - `POST /invitations/accept` `{ invitation }` (an id or a link's token): 200 `{ membership }`;
 *   403 `other-account`, 409 `already-member`, 410 `invitation-gone`; an account deleted while
 *   the answer waited is 401 `unauthorized`, as a token that holds no session is.
 * - `POST /invitations/decline` `{ invitation }`: 204; refused as an accept is, but for
 *   `already-member`.
 *
 * The routes but the read are for the identity whose live session the device's token holds on the
 * device it names in `X-Perch-Device`. A method a path does not take answers 405 with the one it
 * does in `Allow`; a body that does not follow its schema, 400 `bad-request`; a limit, 429
 * `rate-limited` with `Retry-After`; a failure of the gateway, 500 `internal`, the failure itself
 * handed to `onFailure`. A request for another path is not answered here (`undefined`), so the
 * server can try its other routes.
 */
export function invitationRoutes(
  sessions: Pick<AuthSessions, 'read'>,
  organisations: Organisations,
  options: InvitationRoutesOptions,
): (request: Request, from: string) => Promise<Response | undefined> {
  const errorResponse = errorAnswer(options.onFailure)
  const callerErrorResponse = callerErrorAnswer(options.onFailure)

  const mine: Handler = async (identity) =>
    (await organisations.invitations.mine({ identity })).match(
      (invitations) => Response.json({ invitations }),
      errorResponse,
    )

  const accept: Handler = async (identity, request) => {
    const body = answerBody.safeParse(await readBody(request))

    if (!body.success) {
      return badRequest()
    }

    return (
      await organisations.invitations.accept({ identity, invitation: body.data.invitation })
    ).match((membership) => Response.json({ membership }), callerErrorResponse)
  }

  const decline: Handler = async (identity, request) => {
    const body = answerBody.safeParse(await readBody(request))

    if (!body.success) {
      return badRequest()
    }

    return (
      await organisations.invitations.decline({ identity, invitation: body.data.invitation })
    ).match(() => new Response(null, { status: 204 }), callerErrorResponse)
  }

  /** What a read of a link answers, for a guest or for the account whose token the request carries. */
  async function read(request: Request, from: string): Promise<Response> {
    // The limit goes first: a refused read costs the same whatever the body and the token hold.
    const allowance = options.limits.invitationLink(from)

    if (!allowance.allowed) {
      return tooMany(allowance)
    }

    const body = readBodySchema.safeParse(await readBody(request))

    if (!body.success) {
      return badRequest()
    }

    const { token } = body.data
    const showing = async (caller?: { email: string }) =>
      (await organisations.invitations.read({ token, caller })).match(
        (invitation) => Response.json({ invitation }),
        errorResponse,
      )

    if (bearerToken(request) === undefined) {
      return showing()
    }

    return match(await bearerCaller(sessions, request))
      .with({ kind: 'caller' }, ({ email }) => showing({ email }))
      .with({ kind: 'unauthorized' }, async () => bearerRefused())
      .with({ kind: 'bad-request' }, async () => badRequest())
      .with({ kind: 'failed' }, async ({ error }) => errorResponse(error))
      .exhaustive()
  }

  /** Answers a request of the identity whose session it carries. */
  async function signedIn(handler: Handler, request: Request, from: string): Promise<Response> {
    return match(await bearerCaller(sessions, request))
      .with({ kind: 'caller' }, ({ identity }) => handler(identity, request, from))
      .with({ kind: 'unauthorized' }, async () => bearerRefused())
      .with({ kind: 'bad-request' }, async () => badRequest())
      .with({ kind: 'failed' }, async ({ error }) => errorResponse(error))
      .exhaustive()
  }

  /** The paths the routes answer, each with the one method it takes and what answers it. */
  const routes: ReadonlyMap<
    string,
    {
      readonly method: string
      readonly answer: (request: Request, from: string) => Promise<Response>
    }
  > = new Map([
    ['/invitations', { method: 'GET', answer: (request, from) => signedIn(mine, request, from) }],
    ['/invitations/read', { method: 'POST', answer: read }],
    [
      '/invitations/accept',
      { method: 'POST', answer: (request, from) => signedIn(accept, request, from) },
    ],
    [
      '/invitations/decline',
      { method: 'POST', answer: (request, from) => signedIn(decline, request, from) },
    ],
  ])

  return async (request, from) => {
    const route = routes.get(new URL(request.url).pathname)

    if (!route) {
      return undefined
    }

    if (request.method !== route.method) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: route.method } },
      )
    }

    return route.answer(request, from)
  }
}
