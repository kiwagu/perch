import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { deviceId, type Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { Organisations } from '../tenants/organisations'

import type { DeviceSessions } from './device-sessions'
import { type IdentitySessions, keysRefused, type SignedIn } from './identity-sessions'

/** What a device sends to sign up or in: the credentials, and the device's id and label. */
const credentialsBody = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  device: z.object({ id: deviceId, label: z.string().max(60) }),
})

/** The access token in an `Authorization` header. */
const BEARER = /^Bearer +(\S+)$/i

/** The header a device names itself in on every call with an access token. */
export const DEVICE_HEADER = 'X-Perch-Device'

/**
 * Who a call with an access token comes from: the identity the token signs in and the device
 * it names, whose session is live; or why the call is refused.
 */
export type BearerCaller =
  | { readonly kind: 'caller'; readonly identity: IdentityId; readonly device: string }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'failed'; readonly error: DataError }

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

/**
 * Who the request comes from: the device it names in `X-Perch-Device` must follow the protocol's
 * device id (checked first, before any call to the database), its access token must sign an
 * identity in (a refresh key is not taken), and that device of the identity must have a live
 * session. A device signed out from another one is refused at once, though its access token
 * still works. A token the database could not judge is no refusal: the call failed.
 */
export async function bearerCaller(
  sessions: Pick<IdentitySessions, 'authenticate'>,
  devices: Pick<DeviceSessions, 'bind'>,
  request: Request,
): Promise<BearerCaller> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (!device.success) {
    return { kind: 'bad-request' }
  }

  const access = bearerToken(request)

  if (access === undefined) {
    return { kind: 'unauthorized' }
  }

  const authenticated = await sessions.authenticate({ access })

  if (authenticated.isErr()) {
    return keysRefused(authenticated.error)
      ? { kind: 'unauthorized' }
      : { kind: 'failed', error: authenticated.error }
  }

  const identity = authenticated.value.identity.id
  const binding = await devices.bind({ identity, device: device.data })

  if (binding.isErr()) {
    return { kind: 'failed', error: binding.error }
  }

  return binding.value.kind === 'bound'
    ? { kind: 'caller', identity, device: device.data }
    : { kind: 'unauthorized' }
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
