import { z } from '@workspace/zod'

import type { SignInAttempt, SignInOutcome } from '../../limits/request-limits'

import type { AuthMountDeps } from './mount'
import { secondFactorAnswer } from './second-factor-asked'

/** A sign-in the limits let through, to settle once Better Auth answered it. */
export type AllowedAttempt = Extract<SignInAttempt, { readonly allowed: true }>

/** The code of the mount's own refusal, as far as `outcomeOf` reads it. */
const refusalCode = z.object({ code: z.string() })

/**
 * The 403 codes that come after Better Auth checked the password: its refusal of an account whose
 * email is not verified yet, and of a banned account (`BANNED_USER`, or the admission's own,
 * answered `account-banned` either way).
 */
const AFTER_THE_PASSWORD: ReadonlySet<string> = new Set(['EMAIL_NOT_VERIFIED', 'account-banned'])

/**
 * Whether the second factor of the account `email` signs in to is on, read now: an account whose
 * factor is on is signed in only by a code, so its right password alone is no sign-in's last step.
 * A read that failed counts as on, so a doubt forgets nothing.
 */
function secondFactorOn(deps: AuthMountDeps, email: string): Promise<boolean> {
  return deps.passwords.credentialOf(email).match(
    (credential) => credential?.secondFactor === true,
    () => true,
  )
}

/**
 * What the mount's answer to a sign-in means for its email's limit: 200 signed in, and 409, a
 * sign-in asked about the account's limit of devices once Better Auth accepted it, both judged the
 * password right, and so does a 403 coded `EMAIL_NOT_VERIFIED` or `account-banned` for an account
 * whose second factor is off. A password step answered with a challenge (`secondFactorAnswer`)
 * judged nothing: the right password of an account whose second factor is on is not a sign-in's
 * last step, so it neither counts nor forgets; nor does a 403 after the password for such an
 * account, whose second factor is read again when the refusal is judged (`secondFactorOn`), so a
 * factor turned on meanwhile counts. Any other 403 judged nothing: a refusal of the request's
 * origin, of its Fetch Metadata or of its callback comes before Better Auth checks the password, so
 * a forged request would otherwise clear the failed sign-ins of any email it names; nor does a 403
 * whose code cannot be read. A 401 judged the password wrong, any other status nothing. The body is
 * read from a copy of the answer: the client gets it untouched.
 */
async function outcomeOf(
  deps: AuthMountDeps,
  email: string,
  response: Response,
): Promise<SignInOutcome> {
  if (response.status === 403) {
    const body = refusalCode.safeParse(
      await response
        .clone()
        .json()
        .catch(() => undefined),
    )

    if (!body.success || !AFTER_THE_PASSWORD.has(body.data.code)) {
      return 'unjudged'
    }

    return (await secondFactorOn(deps, email)) ? 'unjudged' : 'succeeded'
  }

  if (response.status === 200) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)

    return secondFactorAnswer.safeParse(body).success ? 'unjudged' : 'succeeded'
  }

  if (response.status === 409) {
    return 'succeeded'
  }

  return response.status === 401 ? 'failed' : 'unjudged'
}

/**
 * Asks Better Auth for the sign-in of `email`, then settles its `attempt` exactly once with what
 * the answer means for the email's failed sign-ins (`outcomeOf`), a throw included: a sign-in
 * nobody answered was not judged, and gives its place back.
 */
export async function settling(
  deps: AuthMountDeps,
  email: string,
  attempt: AllowedAttempt,
  ask: () => Promise<Response>,
): Promise<Response> {
  let outcome: SignInOutcome = 'unjudged'

  try {
    const response = await ask()

    outcome = await outcomeOf(deps, email, response)

    return response
  } finally {
    attempt.settle(outcome)
  }
}
