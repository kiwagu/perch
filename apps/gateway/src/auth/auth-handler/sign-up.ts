import { SUPPORTED_LOCALES } from '@workspace/i18n'
import { CONTRACT_VALUES, keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { until } from '../../floor'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { profileNameOf } from '../profile-name'
import { STARTING_LANGUAGE_BUDGET_MS } from '../starting-language.port'

import type { AuthMountDeps } from './mount'
import { refusalOf, withJsonBody } from './requests'

/**
 * The time a sign-up's floor keeps above Better Auth's work: above the work of either branch (a new
 * account's writes, a taken email's made-up account) and above Better Auth's own floor for a
 * resend.
 */
export const SIGN_UP_WORK_MS = 800

/**
 * How soon, at the earliest, an accepted sign-up answers after its request began: the starting
 * language's budget, then the time kept above Better Auth's work, so the time of the answer tells
 * nothing of the email, in this process and while that work stays under it, however long the
 * lookup took.
 */
export const SIGN_UP_FLOOR_MS = STARTING_LANGUAGE_BUDGET_MS + SIGN_UP_WORK_MS

/**
 * As much of a sign-up's body as the mount reads before Better Auth does: the email its turn is
 * taken by (at most the `email` value's length), the password the rules of a new password are
 * checked on, the name the rule of a profile's name is, and the language, none or one the app
 * speaks.
 */
const signUpBody = z.object({
  email: z.string().min(1).max(CONTRACT_VALUES.email.maxLength),
  password: z.string(),
  name: z.string(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
})

/** The sign-up's JSON as sent, every field kept. */
const sentBody = z.looseObject({})

/**
 * Hands Better Auth a sign-up, once the client address's verification mails took it (every sign-up
 * counts, whatever its email), one email's sign-ups at a time in this process (two at once of a new
 * email would answer a success and a failure), with the very JSON the email was read from. A
 * password that breaks the rules of a new password (`keepsPasswordRules`) is refused first, 400
 * `weak-password`, at once: before the email's turn, Better Auth and the directory, so the
 * refusal reads nothing of the email. So is a name that breaks the rule of a profile's name
 * (`profileNameOf`): 400 `name-required` (nothing left once trimmed) or `name-too-long`; and a
 * language the app does not speak is a refused body, 400 `bad-request`, which looks nothing up. Better
 * Auth's answer names the account it made, or, for an
 * email that has one, an account it made up whose fields differ: the client gets `202` with no
 * body for both, no sooner than `SIGN_UP_FLOOR_MS` after the request began. A sign-up starts in
 * the default language of the organisation that invited the email (`startingLanguage`, looked up
 * for a new email and a taken one alike), the JSON handed on with that language alone replaced;
 * a refusal of Better Auth's after that lookup (a malformed email) waits for the same floor, so its
 * time tells nothing of the lookup. Nothing is signed in, so no socket closes.
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

  const name = profileNameOf(body.data.name)

  if (name.isErr()) {
    return Response.json({ code: name.error }, { status: 400 })
  }

  const email = body.data.email.toLowerCase()
  const original = sentBody.parse(sent)
  const chosen = await deps.startingLanguage.of(email)
  const handed = chosen === undefined ? original : { ...original, locale: chosen }
  const answer = await deps.accounts.run(email, () =>
    deps.auth.handler(withJsonBody(request, handed)),
  )

  await until(deps.clock, started + SIGN_UP_FLOOR_MS)

  if (answer.status !== 200) {
    return refusalOf(answer)
  }

  return new Response(null, { status: 202 })
}
