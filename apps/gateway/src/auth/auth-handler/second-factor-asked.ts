import { z } from '@workspace/zod'

import { type SignInCredential, signInStands } from '../account-passwords'

import { setCookieValue } from './challenge-cookie'
import type { AuthMountDeps } from './mount'
import { internal, notSignedIn, refused } from './requests'
import type { JudgedAnswer } from './sign-in-settlement'

/**
 * What Better Auth answers a password step of an account whose second factor is on, once it
 * checked the password: no session, a challenge in its cookie, waiting for a code of the account's
 * key or for one of its backup codes.
 */
export const asksSecondFactor = z.object({ twoFactorRedirect: z.literal(true) })

/**
 * Answers a password step of an account whose second factor is on, once Better Auth checked the
 * password and answered with a challenge (`asksSecondFactor`), and held it as the password door
 * holds a session: the challenge is read from Better Auth's cookie (`setCookieValue`, by the name
 * Better Auth gives the cookie), the account it belongs to from its own row (`ownerOf`: Better
 * Auth's answer names none), and the email's account and the hash of its password again
 * (`credentialOf`). The step stands only when both reads of the email found that very account with
 * the same password (`signInStands`), as a sign-in that wrote a session does: then the answer is
 * `200 { secondFactor: { challenge } }`, the challenge in the form Better Auth set it, and nothing
 * of Better Auth's own answer, no token and no cookie. Better Auth wrote a session at the step and
 * deleted it at once: it was written waiting for its admission, so it ended no session of the
 * device's, and its delete ended it. When the step does not stand (a confirmation moved the email,
 * a reset or a change gave the account a new password meanwhile), the challenge's rows go and the
 * answer is the wrong credentials' 401; when the second read finds the account banned (a ban
 * committed after Better Auth's own gate), they go and the answer is 403 `account-banned`. A
 * change that commits after the second read ends the challenge itself or is met at the code step.
 * A challenge the answer does not carry, a read that failed, or an ending that failed answers 500
 * `internal`, the challenge handed to nobody.
 *
 * Each step that wrote a challenge first reclaims some of those earlier steps left unanswered and
 * expired (`TwoFactorChallenges.reclaim`): this is where challenges are written, so their backlog
 * drains at the pace they are made, whatever the passkeys do. A reclaim that failed answers 500
 * `internal` too, the new challenge handed to nobody (it expires, and a later step reclaims it).
 *
 * Each answer carries what it means for the email's failed sign-ins (`JudgedAnswer`), decided here
 * and not read again later: the challenge and the ban's refusal judged nothing (the right password
 * of an account whose second factor is on is not a sign-in's last step, whatever becomes of the
 * account after), the wrong credentials' 401 counts as a failure, a 500 judged nothing.
 */
export async function secondFactorAsked(
  deps: AuthMountDeps,
  answer: Response,
  email: string,
  before: SignInCredential | undefined,
): Promise<JudgedAnswer> {
  const unjudged = (response: Response): JudgedAnswer => ({ response, outcome: 'unjudged' })
  const challenge = setCookieValue(answer, await deps.challenges.cookieName())

  if (challenge === undefined) {
    return unjudged(internal())
  }

  // Each step that writes a challenge reclaims some left unanswered, which nothing else does.
  if ((await deps.challenges.reclaim()).isErr()) {
    return unjudged(internal())
  }

  const owner = await deps.challenges.ownerOf(challenge)
  const after = await deps.passwords.credentialOf(email)

  if (owner.isErr() || after.isErr()) {
    return unjudged(internal())
  }

  const stands = owner.value !== undefined && signInStands(before, after.value, owner.value)

  if (stands && after.value?.banned === false) {
    return unjudged(Response.json({ secondFactor: { challenge } }, { status: 200 }))
  }

  if ((await deps.challenges.end(challenge)).isErr()) {
    return unjudged(internal())
  }

  return stands
    ? unjudged(refused(403, 'account-banned'))
    : { response: notSignedIn(), outcome: 'failed' }
}
