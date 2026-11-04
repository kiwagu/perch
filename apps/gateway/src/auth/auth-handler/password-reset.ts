import { keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { bearerCaller } from '../bearer-caller'

import { until } from './floor'
import type { AuthMountDeps } from './mount'
import { afterPasswordChange } from './password-changed'
import { badRequest, internal, refused } from './requests'

/**
 * How soon, at the earliest, a request for a reset mail answers after it began: above the work of
 * either branch (keeping a link, ending the earlier ones and starting the mail for an email that
 * has an account; Better Auth's look-up standing in for it for one that has none), so neither the
 * answer nor its time tells whether the email has an account, in this process and while that work
 * stays under it.
 */
export const RESET_REQUEST_FLOOR_MS = 800

const requestBody = z.object({ email: z.string().min(1).max(320) })
const resetBody = z.object({ token: z.string().min(1).max(4096), password: z.string() })

/**
 * Asks for a reset mail to the email of the body (`{ email }`). One of the client address's mails
 * and one of the email's reset mails are taken first (`RequestLimits.resetMail`, 429 when either
 * is spent); then, in the account's turn (by the email in lower case), Better Auth keeps a new
 * link and the mail starts, for an email that has an account; the earlier links of the account
 * end at once. Every request it took answers `202` with no body, alike for any email, no sooner
 * than `RESET_REQUEST_FLOOR_MS` after it began; one whose email is not an email answers 400
 * `bad-request` at once.
 */
export async function requestPasswordReset(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const started = deps.clock.now()
  const body = requestBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const email = body.data.email.toLowerCase()
  const allowed = deps.limits.resetMail(from, email)

  if (!allowed.allowed) {
    return tooMany(allowed)
  }

  const asked = await deps.accounts.run(email, () => deps.passwords.requestReset(email))

  if (asked.isErr()) {
    return internal()
  }

  if (asked.value === 'refused') {
    return badRequest()
  }

  await until(deps.clock, started + RESET_REQUEST_FLOOR_MS)

  return new Response(null, { status: 202 })
}

/**
 * Sets a new password with a reset link's token (`{ token, password }`). The client address's
 * attempts are taken first (`RequestLimits.passwordReset`, 429 once spent, whatever came of the
 * earlier ones). A password that breaks the rules of a new password answers 400
 * `password-rejected` at once, the link kept. A token no link holds (unknown, used, or replaced by
 * a newer one) answers 401 `link-invalid`, one whose link is an hour old 401 `link-expired`. The
 * new password is hashed, as Better Auth hashes one, before the account's turn (by its identity);
 * in it, one transaction judges the link again on the clock as it is then (401 `link-invalid` or
 * `link-expired`, nothing changed), spends it with every other reset link of the account, sets
 * the password, ends every session of the account and its pending change of email, all or none
 * (`AccountPasswords.reset`; 500 `internal` with nothing changed when it fails). Once it
 * committed, the account's sockets close with 4002 and the notice of a changed password starts
 * (`afterPasswordChange`): 200 `{ signedOut }`, true when the session the request carries (its
 * token and device, as on the device routes) was the account's, so one of those ended, and false
 * for another account's, a dead one or none: a device signed in to the account signs out with no
 * channel to hear the 4002. That session is read in the account's turn, before the reset ends it;
 * one that could not be read answers 500 `internal`, nothing changed. Nothing is signed in,
 * whatever session the request carries.
 */
export async function resetPassword(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const attempt = deps.limits.passwordReset(from)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  const body = resetBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const { token, password } = body.data

  if (!keepsPasswordRules(password)) {
    return refused(400, 'password-rejected')
  }

  const link = await deps.resets.read(token)

  if (link.isErr()) {
    return internal()
  }

  if (link.value === undefined) {
    return refused(401, 'link-invalid')
  }

  if (link.value.expiresAt.getTime() <= deps.clock.now()) {
    return refused(401, 'link-expired')
  }

  const { identity } = link.value
  const hash = await deps.passwords.hash(password)

  if (hash.isErr()) {
    return internal()
  }

  return deps.accounts.run(identity, async () => {
    const caller = await bearerCaller(deps.sessions, request)

    if (caller.kind === 'failed') {
      return internal()
    }

    // The link is judged again at its spending, on the clock as it is then: it may have been
    // spent, replaced or expired while the reset waited for the account.
    const reset = await deps.passwords.reset(identity, token, hash.value)

    if (reset.isErr()) {
      return internal()
    }

    if (reset.value !== 'reset') {
      return refused(401, reset.value)
    }

    await afterPasswordChange(deps, identity, 'every')

    return Response.json({ signedOut: caller.kind === 'caller' && caller.identity === identity })
  })
}
