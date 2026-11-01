/**
 * What a sign-in does with the token it was given once it will not keep it (a throw while it held
 * the token, a space that did not open): a token neither saved nor left to sign out would be a
 * live session at the gateway that nobody ends.
 */

import { forgetDevice, type KeyValueStorage, savedToken } from '../storage'

import type { PendingRevoke } from './pending-revoke'

/**
 * Lets go of a sign-in's `token`: it goes to be signed out first, then the device a save made is
 * forgotten while the saved token is still this one (another tab's later sign-in of the account
 * saved its own, which stays). Neither step is stopped by a throw of the other, and nothing of a
 * throw is kept: its text may carry a token. Answers whether both steps ran without a throw.
 */
export function cleanUpSignIn(
  storage: KeyValueStorage,
  pendingRevoke: Pick<PendingRevoke, 'leave'>,
  token: string,
): boolean {
  let whole = true

  try {
    pendingRevoke.leave(token)
  } catch {
    // The token could not be handed off; the device is forgotten all the same.
    whole = false
  }

  try {
    if (savedToken(storage) === token) {
      forgetDevice(storage)
    }
  } catch {
    // The cleanup broke off; the token was handed off before it all the same.
    whole = false
  }

  return whole
}
