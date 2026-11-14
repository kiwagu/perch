import { keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { until } from '../../floor'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'

import type { AuthMountDeps } from './mount'
import { refusalOf, withJsonBody } from './requests'

/**
 * How soon, at the earliest, an accepted sign-up answers after its request began: above the work of
 * either branch (a new account's writes, a taken email's made-up account) and above Better Auth's
 * own floor for a resend, so the time of the answer tells nothing of the email, in this process and
 * while that work stays under it.
 */
export const SIGN_UP_FLOOR_MS = 800

/**
 * As much of a sign-up's body as the mount reads before Better Auth does: the email its turn is
 * taken by, and the password the rules of a new password are checked on.
 */
const signUpBody = z.object({ email: z.string().min(1).max(320), password: z.string() })

/**
 * Hands Better Auth a sign-up, once the client address's verification mails took it (every sign-up
 * counts, whatever its email), one email's sign-ups at a time in this process (two at once of a new
 * email would answer a success and a failure), with the very JSON the email was read from. A
 * password that breaks the rules of a new password (`keepsPasswordRules`) is refused first, 400
 * `weak-password`, at once: before the email's turn, Better Auth and the directory, so the
 * refusal reads nothing of the email. Better Auth's answer names the account it made, or, for an
 * email that has one, an account it made up whose fields differ: the client gets `202` with no
 * body for both, no sooner than `SIGN_UP_FLOOR_MS` after the request began. A refusal of Better
 * Auth's (a malformed email, a language the gateway does not speak) passes as its status and code
 * alone; it does not depend on the email having an account. Nothing is signed in, so no socket
 * closes.
 */
export async function signUp(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const started = deps.clock.now()
  const mails = deps.limits.verificationMail(from)

  if (!mails.allowed) {
    return tooMany(mails)
  }

  const sent = await readBody(request)
  const body = signUpBody.safeParse(sent)

  if (!body.success) {
    return Response.json({ code: 'bad-request' }, { status: 400 })
  }

  if (!keepsPasswordRules(body.data.password)) {
    return Response.json({ code: 'weak-password' }, { status: 400 })
  }

  const answer = await deps.accounts.run(body.data.email.toLowerCase(), () =>
    deps.auth.handler(withJsonBody(request, sent)),
  )

  if (answer.status !== 200) {
    return refusalOf(answer)
  }

  await until(deps.clock, started + SIGN_UP_FLOOR_MS)

  return new Response(null, { status: 202 })
}
