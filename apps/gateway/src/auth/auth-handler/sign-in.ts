import { match } from 'ts-pattern'

import { idSchemas } from '@workspace/ids'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { type AccountStart, type SignInCredential, signInStands } from '../account-passwords'
import { hasPasswordLength, NO_ACCOUNTS_PASSWORD } from '../password-length'
import { ADMISSION_HEADER } from '../session-hooks'

import { closeDevice } from './close-device'
import type { AuthMountDeps } from './mount'
import { notSignedIn, refusalOf, withJsonBody } from './requests'
import { asksSecondFactor, secondFactorAsked } from './second-factor-asked'
import { settling } from './sign-in-settlement'

/** The sign-in each email's failed sign-ins are counted on. */
export const SIGN_IN_PATH = '/auth/sign-in/email'

/**
 * What a sign-in's body must name before anything is read for its email: its email, of at most
 * the `email` value's length (a longer one is no account's), and a password, as strings. A
 * password of a length no account's password has, the empty one included, reaches Better Auth as
 * `NO_ACCOUNTS_PASSWORD` (`hasPasswordLength`), so it is checked, timed, counted and refused as a
 * wrong one, after the same checks of the request (its origin, the email's shape) as any other;
 * Better Auth would fail to hash an empty one. `signOutOldest`, true once the person confirmed a
 * sign-in past the account's limit of devices, is the gateway's: Better Auth gets the rest.
 */
const signInBody = z.looseObject({
  email: z.string().max(CONTRACT_VALUES.email.maxLength),
  password: z.string(),
  signOutOldest: z.boolean().optional(),
})

/**
 * An accepted sign-in's answer as far as the gateway reads it and the device gets it: the raw
 * session token, and the account's id, email, name and whether its email is verified. Nothing else
 * of Better Auth's answer is kept: the account's role and ban (`role`, `banned`, `banReason`,
 * `banExpires`, which the admin plugin adds), its `image`, its language, its timestamps, and
 * `redirect` and `url`, or any field a later version adds.
 */
const acceptedSession = z.object({
  token: z.string().min(1),
  user: z.object({
    id: idSchemas.identity.schema,
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
  }),
})

type AcceptedSession = z.infer<typeof acceptedSession>

/**
 * Hands a sign-in to Better Auth and holds what it signed in to the account Better Auth names
 * (the answer's `user.id`): the email's account and the hash of its password are read again once
 * Better Auth answered 200, after it wrote the session, and the sign-in stands only when both
 * reads found that very account with the same password (`signInStands`). Otherwise a confirmation
 * moved the email between accounts, however often, or a reset or a change gave the account a new
 * password, while Better Auth looked it up or checked the old password: the session it wrote is
 * ended at once by its token and the sign-in answers as wrong credentials do (401), or 500
 * `internal` when the answer names no session, or the second read or that ending failed. A reset
 * or a change ends every session present when its transaction commits, so a session written
 * before it is ended by it, and one written after is ended here. Either way the device's earlier
 * session is left as it was. A sign-in that stands is then admitted against the account's limit of devices
 * (`AuthSessions.admit`, `signOutOldest` its confirmation): one that would bring the account past
 * it unconfirmed has its session deleted and answers 409 `device-limit`, nothing signed in, the
 * device's earlier session left as it was; a confirmed one signs out the device seen least
 * recently, whose sockets close with 4003. An admitted session ends the device's earlier one, so
 * the device's sockets close then (`closeDevice`). The admission reads the account's ban in its
 * transaction: a ban that committed after Better Auth's own gate read the account unbanned answers
 * 403 `account-banned`, no token, the new session ended `banned` (by the ban, or by the admission
 * when it was written after the ban), the device's earlier session left to the ban. Until its
 * admission the session waits (`pending`), counted by no other admission, listed nowhere and read
 * by no caller: an admission that failed answers 500 `internal` and ends the new session by its
 * token, and should that ending fail too, the session keeps waiting, never handed out. Any other
 * answer reaches the client as its status and code alone (`refusalOf`: Better Auth's own refusal
 * of a banned account, after the password, as 403 `account-banned`); an accepted one by its
 * allowlist alone (`signedIn`): the token and the account's id, email, name and whether its email
 * is verified, without its cookies, and with `start` (`{ name, locale }`, what the account signed
 * in to signed up with) while that account has not started: its profile or its settings have not reached the
 * directory, so the device that signs in creates them, as the device that verifies the email by
 * the sign-up mail's link does. An accepted answer that names less of them is one that names no
 * session (500 `internal`). An account whose second factor is on gets no session from its password:
 * Better Auth answers with a challenge, which the gateway holds to the same second read
 * (`secondFactorAsked`).
 */
async function handedOver(
  deps: AuthMountDeps,
  request: Request,
  email: string,
  before: SignInCredential | undefined,
  signOutOldest: boolean,
): Promise<Response> {
  const response = await deps.auth.handler(request)

  if (response.status !== 200) {
    return refusalOf(response)
  }

  const answer: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)

  if (asksSecondFactor.safeParse(answer).success) {
    return secondFactorAsked(deps, response, email, before)
  }

  const accepted = acceptedSession.safeParse(answer)
  const after = await deps.passwords.credentialOf(email)
  const stands =
    accepted.success && after.isOk() && signInStands(before, after.value, accepted.data.user.id)
  const ended =
    stands || (accepted.success && (await deps.sessions.signOut(accepted.data.token)).isOk())

  if (after.isErr() || !ended) {
    return Response.json({ code: 'internal' }, { status: 500 })
  }

  if (!stands || !accepted.success) {
    return notSignedIn()
  }

  const { token, user } = accepted.data
  const admission = await deps.sessions.admit(user.id, token, signOutOldest)

  if (admission.isErr()) {
    const internal = () => Response.json({ code: 'internal' }, { status: 500 })

    // The session was never handed to its device: it is ended, and the answer is 500 either way;
    // an ending that failed leaves it waiting for an admission, which nothing counts or lists.
    return (await deps.sessions.signOut(token)).match(internal, internal)
  }

  return match(admission.value)
    .with({ kind: 'asked' }, () => Response.json({ code: 'device-limit' }, { status: 409 }))
    .with({ kind: 'banned' }, () => Response.json({ code: 'account-banned' }, { status: 403 }))
    .with({ kind: 'admitted' }, { kind: 'signed-out' }, async (admitted) => {
      // The admission ended the device's earlier session: the sockets it opened with it close.
      await closeDevice(request, response, deps.connections)

      if (admitted.kind === 'signed-out') {
        await deps.connections.close(user.id, admitted.device, CLOSE.deviceLimit)
      }

      // The account the sign-in stands for is the one the second read found.
      return signedIn(response, accepted.data, after.value?.start)
    })
    .exhaustive()
}

/**
 * An accepted sign-in's answer as the device gets it, built from `session`, the parsed answer,
 * never forwarded: `{ token, user: { id, email, name, emailVerified } }`, and `start` (the name and
 * the language the account signed up with) when the account has not started, which tells the
 * device to start it. Better Auth's other headers are kept, but not its cookies: the web signs in
 * by bearer token alone, so a session cookie would serve nothing and outlive a sign-out in the
 * browser.
 */
function signedIn(
  response: Response,
  session: AcceptedSession,
  start: AccountStart | undefined,
): Response {
  const headers = new Headers(response.headers)

  for (const name of ['set-cookie', 'content-length', 'content-type']) {
    headers.delete(name)
  }

  const { token, user } = session
  const answer = {
    token,
    user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
  }

  return Response.json(
    start === undefined ? answer : { ...answer, start: { name: start.name, locale: start.locale } },
    { status: 200, headers },
  )
}

/**
 * A sign-in: its body must be JSON naming an email of at most the `email` value's length and a
 * password (else 400 `bad-request`, before anything is read for the email), and the email, in
 * lower case, must find a place among its failed sign-ins and those still under way
 * (`RequestLimits.signInAttempt`; else 429). Better Auth gets that very JSON, a password of a
 * length no account's password has replaced by `NO_ACCOUNTS_PASSWORD`, and the place is settled
 * once with what it answered (`settling`): a 401 counts as a failed sign-in; an accepted one, one
 * asked about the account's limit of devices, and a refusal that came after the password was
 * checked (403 `EMAIL_NOT_VERIFIED` or `account-banned`) of an account whose second factor is off
 * clear the email's failed sign-ins; the challenge of an account whose second factor is on
 * (`secondFactorAsked`), a refusal after the password for such an account, a refusal that came
 * before the password (403 for the request's origin, its Fetch Metadata or its callback) and any
 * other answer count nothing and give the place back. A sign-in takes no turn of the
 * account: it runs alike, and as soon, whether the email has an account and whatever work of that
 * account is under way. Instead the email's account and the hash of its password are read before
 * Better Auth checks the password (`AccountPasswords.credentialOf`, the same read for an email
 * that has no account), and again once it wrote the session (`handedOver`), so no session
 * outlives the password it was opened with, nor survives the move of its email to another account.
 * A first read that fails answers 500 `internal`, nothing checked. A sign-in that stands is then
 * admitted against the account's limit of devices (`handedOver`).
 */
export async function signIn(deps: AuthMountDeps, request: Request): Promise<Response> {
  const body = await readBody(request)
  const named = signInBody.safeParse(body)

  if (!named.success) {
    return Response.json({ code: 'bad-request' }, { status: 400 })
  }

  const { signOutOldest = false, password, ...rest } = named.data
  const forwarded = {
    ...rest,
    password: hasPasswordLength(password) ? password : NO_ACCOUNTS_PASSWORD,
  }
  const email = forwarded.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  return settling(deps, email, attempt, async () => {
    const before = await deps.passwords.credentialOf(email)
    // The session Better Auth writes waits for its admission, whatever the client sent.
    const headers = new Headers(request.headers)

    headers.set(ADMISSION_HEADER, 'pending')

    return before.isErr()
      ? Response.json({ code: 'internal' }, { status: 500 })
      : handedOver(
          deps,
          withJsonBody(request, forwarded, headers),
          email,
          before.value,
          signOutOldest,
        )
  })
}
