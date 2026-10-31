import { z } from '@workspace/zod'

import type { SignInAttempt, SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'

import { closeDevice } from './close-device'
import type { AuthMountDeps } from './mount'
import { refusalOf, withJsonBody, withoutCookies } from './requests'

/** The sign-in each email's failed sign-ins are counted on. */
export const SIGN_IN_PATH = '/auth/sign-in/email'

/** As much of a sign-in's body as its email's limit needs; Better Auth gets all of it. */
const signInBody = z.object({ email: z.string() })

/** A sign-in the limits let through, to settle once Better Auth answered it. */
type AllowedAttempt = Extract<SignInAttempt, { readonly allowed: true }>

/**
 * What Better Auth's answer to a sign-in means for its email's limit: 200 signed in and 403 (the
 * password was right, the email is not verified yet) both judged the password right.
 */
function outcomeOf(status: number): SignInOutcome {
  if (status === 200 || status === 403) {
    return 'succeeded'
  }

  return status === 401 ? 'failed' : 'unjudged'
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
 * Hands a request that signs a device in (a sign-up or a sign-in) to Better Auth. An accepted one
 * (200) closes the device's sockets (`closeDevice`) before its answer is returned without its
 * cookies; any other answer reaches the client as its status and code alone (`refusalOf`).
 */
export async function handedOver(deps: AuthMountDeps, request: Request): Promise<Response> {
  const response = await deps.auth.handler(request)

  if (response.status !== 200) {
    return refusalOf(response)
  }

  await closeDevice(request, response, deps.connections)

  return withoutCookies(response)
}

/**
 * A sign-in: its body must be JSON naming an email (else 400 `bad-request`), and the email, in
 * lower case, must find a place among its failed sign-ins and those still under way
 * (`RequestLimits.signInAttempt`; else 429). Better Auth gets that very JSON, and the place is
 * settled once with what it answered.
 */
export async function signIn(deps: AuthMountDeps, request: Request): Promise<Response> {
  const body = await readBody(request)
  const named = signInBody.safeParse(body)

  if (!named.success) {
    return Response.json({ code: 'bad-request' }, { status: 400 })
  }

  const attempt = deps.limits.signInAttempt(named.data.email.toLowerCase())

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  return settling(attempt, () => handedOver(deps, withJsonBody(request, body)))
}
