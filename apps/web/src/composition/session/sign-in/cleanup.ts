/**
 * What a sign-in does with the token it was given once it will not keep it (a throw while it held
 * the token, a space that did not open): a token neither saved nor left to sign out would be a
 * live session at the gateway that nobody ends.
 */

import { forgetSignIn, type KeptSession, type KeyValueStorage } from '../../storage'
import type { PendingRevoke } from '../pending-revoke'

/**
 * Lets go of a sign-in `attempt`: its token goes to be signed out first, then what the attempt
 * saved under its own id is forgotten, all of it or whatever part a broken save left (another
 * tab's later sign-in keeps its own, under its own id). Neither step is stopped by a throw of the
 * other, and nothing of a throw is kept: its text may carry a token. Answers whether both steps
 * ran without a throw.
 */
export function cleanUpSignIn(
  storage: KeyValueStorage,
  pendingRevoke: Pick<PendingRevoke, 'leave'>,
  attempt: KeptSession,
): boolean {
  let whole = true

  try {
    pendingRevoke.leave(attempt.token)
  } catch {
    // The token could not be handed off; the attempt's records are forgotten all the same.
    whole = false
  }

  try {
    forgetSignIn(storage, attempt.signIn)
  } catch {
    // The cleanup broke off; the token was handed off before it all the same.
    whole = false
  }

  return whole
}
