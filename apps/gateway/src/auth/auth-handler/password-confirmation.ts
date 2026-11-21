import type { RequestLimits, SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import type { AccountPasswords } from '../account-passwords'
import type { AuthSessions } from '../auth-sessions'
import { hasPasswordLength } from '../password-length'

import { internal, refused } from './requests'
import { type MountCaller, stillSignedIn } from './signed-in'

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
 * `invalid-credentials`, as one of a length no account's password has (`hasPasswordLength`) does
 * without being checked; a right one gives its place back and forgets none of the failures, which
 * only a sign-in's last step does. Answers the account once the password matched, or the answer
 * that refuses the work.
 */
export async function confirmPassword(
  deps: {
    readonly sessions: Pick<AuthSessions, 'read'>
    readonly limits: Pick<RequestLimits, 'signInAttempt'>
    readonly passwords: Pick<AccountPasswords, 'matches'>
  },
  caller: MountCaller,
  password: string,
): Promise<Response | ConfirmedAccount> {
  const live = await stillSignedIn(deps, caller)

  if (live instanceof Response) {
    return live
  }

  const { email } = live
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  let outcome: SignInOutcome = 'unjudged'

  try {
    if (!hasPasswordLength(password)) {
      outcome = 'failed'
    } else {
      const matches = await deps.passwords.matches(caller.identity, password)

      if (matches.isErr()) {
        return internal()
      }

      // A right password settles nothing: only a sign-in's last step forgets the email's failed
      // sign-ins, so the place it held goes back and the failures stay.
      outcome = matches.value ? 'unjudged' : 'failed'
    }
  } finally {
    attempt.settle(outcome)
  }

  return outcome === 'failed' ? refused(400, 'invalid-credentials') : { email }
}
