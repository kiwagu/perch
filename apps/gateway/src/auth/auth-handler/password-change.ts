import { keepsPasswordRules } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { bearerRefused } from '../bearer-caller'

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
 * `invalid-credentials`; a right one clears them. In the account's turn, the current password is
 * checked against the credential row and the new one hashed; then one transaction makes sure the
 * caller's session is still live (401 `unauthorized` when it ended meanwhile) and the row still
 * holds the hash that was checked, and sets the new password, ends every other session of the
 * account, every reset link and the pending change of its email, all or none
 * (`AccountPasswords.change`; 500 `internal` with nothing changed when it fails). Once it
 * committed, the sockets of the devices whose session it ended close with 4002, the caller's own
 * session and sockets staying, and the notice of a changed password starts
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
        caller.identity,
        caller.session,
        body.data.currentPassword,
        body.data.password,
      )

      if (change.isErr()) {
        return internal()
      }

      if (change.value.kind === 'wrong-password') {
        outcome = 'failed'

        return refused(400, 'invalid-credentials')
      }

      // The caller's session ended while the change waited for the account.
      if (change.value.kind === 'unauthorized') {
        return bearerRefused()
      }

      outcome = 'succeeded'
      await afterPasswordChange(deps, caller.identity, change.value.devices)

      return new Response(null, { status: 204 })
    })
  } finally {
    attempt.settle(outcome)
  }
}
