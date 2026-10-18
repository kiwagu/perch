import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { deviceId, type Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { Organisations } from '../tenants/organisations'

import type { IdentitySessions, SignedIn } from './identity-sessions'

/** What a device sends to sign up or in: the credentials, and the device's id and label. */
const credentialsBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  device: z.object({ id: deviceId, label: z.string().max(60) }),
})

/** The access token in an `Authorization` header. */
const BEARER = /^Bearer +(\S+)$/i

/** The service call behind each path. */
const ACTIONS = new Map<string, 'signUp' | 'signIn'>([
  ['/auth/sign-up', 'signUp'],
  ['/auth/sign-in', 'signIn'],
])

/** A signed-in identity with the organisations it belongs to. */
interface SignedInWithMemberships extends SignedIn {
  readonly memberships: readonly Membership[]
}

/** The request's JSON body, or `undefined` when it is not JSON. */
export async function readBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown
  } catch {
    // A body that is not JSON fails the schema like any other wrong body.
    return undefined
  }
}

/** The access token the request carries as `Authorization: Bearer <access>`, if it does. */
export function bearerToken(request: Request): string | undefined {
  return BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
}

/** The identity the request's access token signs in, if it does; a refresh key is not taken. */
export async function bearerIdentity(
  sessions: Pick<IdentitySessions, 'authenticate'>,
  request: Request,
): Promise<IdentityId | undefined> {
  const access = bearerToken(request)

  if (access === undefined) {
    return undefined
  }

  const device = await sessions.authenticate({ access })

  return device.isOk() ? device.value.identity.id : undefined
}

function signedInResponse({ identity, tokens, memberships }: SignedInWithMemberships): Response {
  return Response.json({
    identity: { id: identity.id, email: identity.email },
    tokens: { access: tokens.access, refresh: tokens.refresh },
    memberships,
  })
}

function errorResponse(error: DataError): Response {
  return match(error.code)
    .with('data:SIGN_UP_REJECTED', () =>
      Response.json({ code: 'sign-up-rejected' }, { status: 409 }),
    )
    .with('data:INVALID_CREDENTIALS', () =>
      Response.json({ code: 'invalid-credentials' }, { status: 401 }),
    )
    .otherwise(() => Response.json({ code: 'internal' }, { status: 500 }))
}

/**
 * Sign-up and sign-in over HTTP: `POST /auth/sign-up` and `POST /auth/sign-in` with
 * `{ email, password, device: { id, label } }` answer `{ identity, tokens, memberships }`, the
 * memberships being the organisations the identity belongs to once it is signed in; the device
 * is recorded with the grant of its pair. A request for another path is not answered here
 * (`undefined`), so the server can try its other routes.
 */
export function authRoutes(
  sessions: Pick<IdentitySessions, 'signUp' | 'signIn'>,
  organisations: Pick<Organisations, 'membershipsOf'>,
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const action = ACTIONS.get(new URL(request.url).pathname)

    if (!action) {
      return undefined
    }

    if (request.method !== 'POST') {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    }

    const body = credentialsBody.safeParse(await readBody(request))

    if (!body.success) {
      return Response.json({ code: 'bad-request' }, { status: 400 })
    }

    const { email, password, device } = body.data
    const result = await sessions[action]({ email, password }, device).andThen((signedIn) =>
      organisations
        .membershipsOf(signedIn.identity.id)
        .map((memberships): SignedInWithMemberships => ({ ...signedIn, memberships })),
    )

    return result.match(signedInResponse, errorResponse)
  }
}
