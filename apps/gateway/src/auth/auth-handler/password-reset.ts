import { keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'

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
 * a newer one) answers 401 `link-invalid`, one whose link is an hour old 401 `link-expired`. In
 * the account's turn (by its identity) the link is spent (401 `link-invalid` when a reset at the
 * same time spent it first) and the password set, hashed as Better Auth hashes one; then every
 * session of the account ends, its sockets close with 4002, every reset link and the pending
 * change of its email end, and the notice of a changed password starts (`afterPasswordChange`):
 * 204 with no body. Nothing is signed in, whatever session the request carries.
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

  return deps.accounts.run(identity, async () => {
    const claimed = await deps.resets.claim(token)

    if (claimed.isErr()) {
      return internal()
    }

    // Spent meanwhile, by a reset at the same time or a newer request's link.
    if (claimed.value?.identity !== identity) {
      return refused(401, 'link-invalid')
    }

    const set = await deps.passwords.set(identity, password)

    if (set.isErr()) {
      return internal()
    }

    const after = await afterPasswordChange(deps, identity)

    return after.isOk() ? new Response(null, { status: 204 }) : internal()
  })
}
