import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { bearerRefused } from '../bearer-caller'

import type { AuthMountDeps } from './mount'
import { internal, refused } from './requests'
import type { MountCaller } from './signed-in'

/** The caller's account once its password matched: its email as it is now, in lower case. */
export interface ConfirmedAccount {
  readonly email: string
}

/**
 * The password a signed-in device sends to confirm work on its own account (a change of the
 * email, a request to delete the account), checked in the account's turn, so no reset or change
 * of the password runs in between. The caller's session is read again, with the account's email
 * as it is now: 401 `unauthorized` when it ended meanwhile or is no longer this device's, 500
 * `internal` when it could not be read. The password must then find a place among that email's
 * failed sign-ins (`RequestLimits.signInAttempt`, 429 when they are spent) and match the
 * credential row, as a sign-in's does: a wrong one keeps its place and answers 400
 * `invalid-credentials`, a right one clears them. Answers the account once the password matched,
 * or the answer that refuses the work.
 */
export async function confirmPassword(
  deps: Pick<AuthMountDeps, 'sessions' | 'limits' | 'passwords'>,
  caller: MountCaller,
  password: string,
): Promise<Response | ConfirmedAccount> {
  const read = await deps.sessions.read(caller.token)

  if (read.kind === 'failed') {
    return internal()
  }

  if (
    read.kind === 'none' ||
    read.caller.identity !== caller.identity ||
    read.caller.device !== caller.device
  ) {
    return bearerRefused()
  }

  const email = read.caller.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  let outcome: SignInOutcome = 'unjudged'

  try {
    const matches = await deps.passwords.matches(caller.identity, password)

    if (matches.isErr()) {
      return internal()
    }

    outcome = matches.value ? 'succeeded' : 'failed'
  } finally {
    attempt.settle(outcome)
  }

  return outcome === 'failed' ? refused(400, 'invalid-credentials') : { email }
}
