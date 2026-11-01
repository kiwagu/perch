import { keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'

import type { AuthMountDeps } from './mount'
import { afterPasswordChange } from './password-changed'
import { badRequest, internal, refused } from './requests'
import { type MountCaller, signedIn } from './signed-in'

const changeBody = z.object({ currentPassword: z.string(), password: z.string() })

/**
 * Changes the caller's password (`{ currentPassword, password }`, with the device's token and
 * `X-Perch-Device`). After the caller is read (`signedIn`), it takes one of the client address's
 * credential checks (429), then: a body it cannot read answers 400 `bad-request`, a new password
 * that breaks the rules 400 `password-rejected` at once. The current password must find a place
 * among its account's failed sign-ins, as a sign-in's does (`RequestLimits.signInAttempt`, by the
 * caller's email; 429 when they are spent), and a wrong one keeps its place there: 400
 * `invalid-credentials`; a right one clears them. In the account's turn, Better Auth checks the
 * current password and sets the new one; then every other session of the account ends and the
 * sockets of their devices close with 4002, the caller's own session and sockets staying, every
 * reset link and the pending change of its email end, and the notice of a changed password starts
 * (`afterPasswordChange`): 204 with no body.
 */
export function changePassword(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  return signedIn(deps, request, (caller) => changed(deps, request, from, caller))
}

async function changed(
  deps: AuthMountDeps,
  request: Request,
  from: string,
  caller: MountCaller,
): Promise<Response> {
  const checks = deps.limits.credentials(from)

  if (!checks.allowed) {
    return tooMany(checks)
  }

  const body = changeBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  if (!keepsPasswordRules(body.data.password)) {
    return refused(400, 'password-rejected')
  }

  const attempt = deps.limits.signInAttempt(caller.email.toLowerCase())

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  let outcome: SignInOutcome = 'unjudged'

  try {
    return await deps.accounts.run(caller.identity, async () => {
      const change = await deps.passwords.change(
        caller.token,
        body.data.currentPassword,
        body.data.password,
      )

      if (change.isErr()) {
        return internal()
      }

      if (change.value === 'wrong-password') {
        outcome = 'failed'

        return refused(400, 'invalid-credentials')
      }

      outcome = 'succeeded'

      const after = await afterPasswordChange(deps, caller.identity, caller.session)

      return after.isOk() ? new Response(null, { status: 204 }) : internal()
    })
  } finally {
    attempt.settle(outcome)
  }
}
