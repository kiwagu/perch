import { idSchemas } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { FRONT_PREFIX } from '../config'
import type { RequestLimits, SignInAttempt, SignInOutcome } from '../limits/request-limits'
import { tooMany } from '../limits/too-many'
import { readBody } from '../read-body'
import type { ConnectionRegistry } from '../sync/connections'
import { SUPERSEDED } from '../sync/sync-connection'

import type { AuthInstance } from './auth-instance'
import { DEVICE_HEADER } from './session-hooks'

/** The paths of Better Auth's routes, as the gateway receives them from the front. */
const AUTH_PATHS = '/auth/'

/** The sign-in each email's failed sign-ins are counted on. */
const SIGN_IN_PATH = '/auth/sign-in/email'

/**
 * The endpoints of Better Auth the gateway hands over, each by `POST` only; every other path under
 * `/auth/` answers 404 here. Handing everything over would expose each endpoint Better Auth and
 * its plugins add, such as the list of an account's sessions with every session's token, or an
 * ending of a session that leaves its device's sockets open; a later feature allows its endpoint
 * here on purpose.
 */
const SERVED_PATHS: ReadonlySet<string> = new Set(['/auth/sign-up/email', SIGN_IN_PATH])

/** As much of a sign-in's body as its email's limit needs; Better Auth gets all of it. */
const signInBody = z.object({ email: z.string() })

/** As much of an accepted sign-up's or sign-in's answer as closing the device's sockets needs. */
const acceptedBody = z.object({ user: z.object({ id: idSchemas.identity.schema }) })

/** A sign-in the limits let through, to settle once Better Auth answered it. */
type AllowedAttempt = Extract<SignInAttempt, { readonly allowed: true }>

/** What Better Auth's answer to a sign-in means for its email's limit. */
function outcomeOf(status: number): SignInOutcome {
  if (status === 200) {
    return 'succeeded'
  }

  return status === 401 ? 'failed' : 'unjudged'
}

/**
 * The URL Better Auth serves the request under: the front's prefix, which the front stripped, put
 * back in front of `/auth/<rest>`, the query kept.
 */
function publicUrl(request: Request): string {
  const url = new URL(request.url)

  url.pathname = `${FRONT_PREFIX}${url.pathname}`

  return url.href
}

/** The request at the path Better Auth serves it under, its method, headers and body as sent. */
function atPublicPath(request: Request): Request {
  return new Request(publicUrl(request), request)
}

/**
 * The sign-in at the path Better Auth serves it under, carrying `body`, the JSON its email was
 * counted from, as JSON. Better Auth reads a body by its content type, a form too, so a body that
 * reads as JSON naming one email and as a form naming another would have the other email's
 * password checked while the first one is counted: it is handed the very body the limit read. The
 * other headers stay; the length is the new body's.
 */
function withCountedBody(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers)

  headers.delete('content-length')
  headers.delete('transfer-encoding')
  headers.set('content-type', 'application/json')

  return new Request(publicUrl(request), {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

/**
 * Better Auth's answer without its `Set-Cookie` headers, its status, body and other headers kept.
 * The web signs in by bearer token alone, so a session cookie would serve nothing and outlive a
 * sign-out in the browser.
 */
function withoutCookies(response: Response): Response {
  const headers = new Headers(response.headers)

  headers.delete('set-cookie')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Closes, with 1000, the sync sockets of the device a sign-up or sign-in Better Auth accepted
 * (`response`, 200) was made on, for the identity its answer names. The new session ended the
 * identity's earlier one on that device, and a socket opened with the earlier token would
 * otherwise go on reading and writing with it, however long the new token stays unused. The
 * close also moves the device's epoch, so a hello with the earlier token whose session read is
 * under way is refused at registration. An answer that is not 200, names no identity, or comes
 * for a request naming no device closes nothing, and nothing of it is logged. Better Auth's
 * answer is read from a copy, so the client still gets all of it.
 */
async function closeDevice(
  request: Request,
  response: Response,
  connections: Pick<ConnectionRegistry, 'close'>,
): Promise<void> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (response.status !== 200 || !device.success) {
    return
  }

  let body: unknown

  try {
    body = await response.clone().json()
  } catch {
    return
  }

  const accepted = acceptedBody.safeParse(body)

  if (accepted.success) {
    await connections.close(accepted.data.user.id, device.data, SUPERSEDED)
  }
}

/**
 * Asks Better Auth, then settles the sign-in `attempt` exactly once with what it answered, a
 * throw included: a sign-in nobody answered was not judged, and gives its place back.
 */
async function settling(attempt: AllowedAttempt, ask: () => Promise<Response>): Promise<Response> {
  let outcome: SignInOutcome = 'unjudged'

  try {
    const response = await ask()

    outcome = outcomeOf(response.status)

    return response
  } finally {
    attempt.settle(outcome)
  }
}

/**
 * Better Auth's sign-up and sign-in behind the gateway's own limits. Of the paths under `/auth/`,
 * only `POST /auth/sign-up/email` and `POST /auth/sign-in/email` are handed to Better Auth's
 * handler, at the path Better Auth serves them under (the front's prefix put back); another
 * method on them answers 405 with `Allow: POST`, and every other path under `/auth/` 404
 * `not-found`, Better Auth not asked. A path outside `/auth/` is not answered here
 * (`undefined`). The device routes come before this one in the server, so the sign-outs they
 * serve under `/auth/` are theirs.
 *
 * Every sign-up and sign-in first takes one of its client address's credential checks
 * (`RequestLimits.credentials`, `from` being the address the server resolved): a refusal answers
 * 429 `rate-limited` with `Retry-After`, Better Auth not asked and no email counted. A sign-in
 * must then find a place among its email's failed sign-ins and those still under way
 * (`RequestLimits.signInAttempt`, the email taken in lower case): a refusal answers 429
 * `rate-limited` with `Retry-After`, Better Auth not asked. A sign-in holds its place until Better
 * Auth answers: 401 (wrong credentials) keeps it as a failure, 200 clears the email's, and any
 * other answer, or a handler that threw, gives it back. A sign-in whose body is not JSON naming an
 * email answers 400 `bad-request`; one that is reaches Better Auth as that JSON, whatever content
 * type it came with, so the email Better Auth checks is the one counted. Better Auth's answers
 * reach the client without their `Set-Cookie` headers.
 *
 * A sign-up or sign-in Better Auth accepts closes the sync sockets of the identity on the device
 * the request names with 1000 (`connections`), before its answer is returned: the new session
 * ended the device's earlier one, and the device connects again with the new token.
 */
export function authHandler(
  auth: Pick<AuthInstance, 'handler'>,
  limits: Pick<RequestLimits, 'credentials' | 'signInAttempt'>,
  connections: Pick<ConnectionRegistry, 'close'>,
): (request: Request, from: string) => Promise<Response | undefined> {
  const ask = async (request: Request) => {
    const response = await auth.handler(request)

    await closeDevice(request, response, connections)

    return withoutCookies(response)
  }

  return async (request, from) => {
    const { pathname } = new URL(request.url)

    if (!pathname.startsWith(AUTH_PATHS)) {
      return undefined
    }

    if (!SERVED_PATHS.has(pathname)) {
      return Response.json({ code: 'not-found' }, { status: 404 })
    }

    if (request.method !== 'POST') {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    }

    const address = limits.credentials(from)

    if (!address.allowed) {
      return tooMany(address)
    }

    if (pathname !== SIGN_IN_PATH) {
      return ask(atPublicPath(request))
    }

    const body = await readBody(request)
    const signIn = signInBody.safeParse(body)

    if (!signIn.success) {
      return Response.json({ code: 'bad-request' }, { status: 400 })
    }

    const attempt = limits.signInAttempt(signIn.data.email.toLowerCase())

    if (!attempt.allowed) {
      return tooMany(attempt)
    }

    return settling(attempt, () => ask(withCountedBody(request, body)))
  }
}
