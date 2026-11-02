import { z } from '@workspace/zod'

import type { SignInAttempt, SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { type SignInCredential, sameCredential } from '../account-passwords'

import { closeDevice } from './close-device'
import type { AuthMountDeps } from './mount'
import { refusalOf, withJsonBody, withoutCookies } from './requests'

/** The sign-in each email's failed sign-ins are counted on. */
export const SIGN_IN_PATH = '/auth/sign-in/email'

/**
 * What a sign-in's body must name before anything is read for its email: its email and its
 * password, as strings. Better Auth gets all of it.
 */
const signInBody = z.object({ email: z.string(), password: z.string() })

/** As much of an accepted sign-in's answer as ending its session needs. */
const acceptedToken = z.object({ token: z.string().min(1) })

/** What Better Auth answers wrong credentials: the refusal a sign-in that could not stand gets. */
const notSignedIn = (): Response =>
  Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 })

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
 * Hands a sign-in to Better Auth and holds what it signed in to the account `before` read: the
 * email's account and the hash of its password are read again once Better Auth answered 200,
 * after it wrote the session. When they are not what they were before, a confirmation moved the
 * email to another account, or a reset or a change gave the account a new password, while Better
 * Auth checked the old one: the session it wrote is ended at once by its token and the sign-in
 * answers as wrong credentials do (401), or 500 `internal` when the second read or that ending
 * failed. A reset or a change ends every session present when its transaction commits, so a session written before it
 * is ended by it, and one written after is ended here. Either way the device's sockets close
 * (`closeDevice`): the device's earlier session ended when the new one was written. Any other answer
 * reaches the client as its status and code alone (`refusalOf`); an accepted one, without its
 * cookies.
 */
async function handedOver(
  deps: AuthMountDeps,
  request: Request,
  email: string,
  before: SignInCredential | undefined,
): Promise<Response> {
  const response = await deps.auth.handler(request)

  if (response.status !== 200) {
    return refusalOf(response)
  }

  const after = await deps.passwords.credentialOf(email)
  const stands = after.isOk() && sameCredential(before, after.value)

  const ended = stands || (await endWritten(deps, response))

  await closeDevice(request, response, deps.connections)

  if (after.isErr() || !ended) {
    return Response.json({ code: 'internal' }, { status: 500 })
  }

  return stands ? withoutCookies(response) : notSignedIn()
}

/**
 * Ends the session an accepted sign-in's answer carries, by its token: true once it ended, or
 * when the answer carries none to end; false when the ending failed.
 */
async function endWritten(deps: AuthMountDeps, response: Response): Promise<boolean> {
  const answer: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  const accepted = acceptedToken.safeParse(answer)

  return accepted.success ? (await deps.sessions.signOut(accepted.data.token)).isOk() : true
}

/**
 * A sign-in: its body must be JSON naming an email and a password (else 400 `bad-request`, before
 * anything is read for the email), and the email, in lower case, must find a place among its
 * failed sign-ins and those still under way (`RequestLimits.signInAttempt`; else 429). Better Auth
 * gets that very JSON, and the place is settled once with what it answered. A sign-in takes no turn
 * of the account: it runs alike, and as soon, whether the email has an account and whatever work
 * of that account is under way. Instead the email's account and the hash of its password are read
 * before Better Auth checks the password (`AccountPasswords.credentialOf`, the same read for an
 * email that has no account), and again once it wrote the session (`handedOver`), so no session
 * outlives the password it was opened with, nor survives the move of its email to another account.
 * A first read that fails answers 500 `internal`, nothing checked.
 */
export async function signIn(deps: AuthMountDeps, request: Request): Promise<Response> {
  const body = await readBody(request)
  const named = signInBody.safeParse(body)

  if (!named.success) {
    return Response.json({ code: 'bad-request' }, { status: 400 })
  }

  const email = named.data.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  return settling(attempt, async () => {
    const before = await deps.passwords.credentialOf(email)

    return before.isErr()
      ? Response.json({ code: 'internal' }, { status: 500 })
      : handedOver(deps, withJsonBody(request, body), email, before.value)
  })
}
