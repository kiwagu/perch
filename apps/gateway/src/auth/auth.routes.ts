import { errAsync, type Result, type ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { deviceId, type Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { RequestLimits, SignInAttempt, SignInOutcome } from '../limits/request-limits'
import { tooMany } from '../limits/too-many'
import { readBody } from '../read-body'
import type { Organisations } from '../tenants/organisations'

import { accountEmail } from './account-email'
import type { IdentitySessions, SignedIn } from './identity-sessions'

/** What a device sends to sign up or in: the credentials, and the device's id and label. */
const credentialsBody = z.object({
  email: accountEmail,
  password: z.string().min(8).max(200),
  device: z.object({ id: deviceId, label: z.string().max(60) }),
})

/** The service call behind each path. */
const ACTIONS = new Map<string, 'signUp' | 'signIn'>([
  ['/auth/sign-up', 'signUp'],
  ['/auth/sign-in', 'signIn'],
])

/** A signed-in identity with the organisations it belongs to. */
interface SignedInWithMemberships extends SignedIn {
  readonly memberships: readonly Membership[]
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

/** What the sign-up and sign-in routes count. */
type CredentialLimits = Pick<RequestLimits, 'credentials' | 'signInAttempt'>

/** What a sign-in's answer means for its email's limit. */
function signInOutcome(checked: Result<SignedIn, DataError>): SignInOutcome {
  if (checked.isOk()) {
    return 'succeeded'
  }

  return checked.error.code === 'data:INVALID_CREDENTIALS' ? 'failed' : 'unjudged'
}

/**
 * Asks the service, then settles the sign-in `attempt` (if any) exactly once with what it
 * answered, a throw included: a sign-in nobody answered was not judged, and gives its place back.
 */
async function settling(
  attempt: SignInAttempt | undefined,
  ask: () => ResultAsync<SignedIn, DataError>,
): Promise<Result<SignedIn, DataError>> {
  let outcome: SignInOutcome = 'unjudged'

  try {
    const checked = await ask()

    outcome = signInOutcome(checked)

    return checked
  } finally {
    if (attempt?.allowed) {
      attempt.settle(outcome)
    }
  }
}

/**
 * Sign-up and sign-in over HTTP: `POST /auth/sign-up` and `POST /auth/sign-in` with
 * `{ email, password, device: { id, label } }` answer `{ identity, tokens, memberships }`, the
 * memberships being the organisations the identity belongs to once it is signed in; the device
 * is recorded with the grant of its pair. A request whose body follows the schema takes a
 * credential check of the address it comes from (`from`), and a sign-in must find a place among
 * its email's failed sign-ins and those still under way, both before the service is asked: either
 * refusal answers 429 `rate-limited` with `Retry-After`. A sign-in holds its place until the
 * database answers: wrong credentials keep it as a failure, a success clears the email's, and an
 * answer the database could not judge, or a service call that threw, gives it back. A request for
 * another path is not answered here (`undefined`), so the server can try its other routes.
 */
export function authRoutes(
  sessions: Pick<IdentitySessions, 'signUp' | 'signIn' | 'withdraw'>,
  organisations: Pick<Organisations, 'membershipsOf'>,
  limits: CredentialLimits,
): (request: Request, from: string) => Promise<Response | undefined> {
  return async (request, from) => {
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
    const address = limits.credentials(from)

    if (!address.allowed) {
      return tooMany(address)
    }

    let attempt: SignInAttempt | undefined

    if (action === 'signIn') {
      attempt = limits.signInAttempt(email)

      if (!attempt.allowed) {
        return tooMany(attempt)
      }
    }

    const checked = await settling(attempt, () => sessions[action]({ email, password }, device))
    const result = await checked.asyncAndThen((signedIn) =>
      organisations
        .membershipsOf(signedIn.identity.id)
        .map((memberships): SignedInWithMemberships => ({ ...signedIn, memberships }))
        // The pair is not answered: the sign-in is taken back, its grant with it.
        .orElse((error) => sessions.withdraw(signedIn).andThen(() => errAsync(error))),
    )

    return result.match(signedInResponse, errorResponse)
  }
}
