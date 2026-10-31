/**
 * The Web Lock that runs the sign-ins of a browser's tabs one at a time, from the request to the
 * gateway to the saved device. The gateway keeps one session per device, so a later sign-in ends
 * the device's earlier session: asked only once the earlier sign-in saved its token, the later one
 * replaces it in the storage with the live one, and no live token is left without a tab keeping
 * it or a sign-out queued for it.
 */

import type { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { LockManagerLike } from '@workspace/replica/sync'

import { oneTabAtATime } from '../../tab-lock'

/** The lock every tab's sign-in holds exclusive. */
export const SIGN_IN_LOCK = 'perch.session.sign-in'

/**
 * A sign-in that threw rather than failing. Nothing of the throw is kept: its text may carry a
 * token.
 */
export const brokenSignIn = (): DataError =>
  dataError('data:AUTH_FAILED', 'the sign-in could not be completed')

/**
 * Runs `attempt` holding the sign-in lock exclusive, and answers once the lock is let go, however
 * the attempt ended, a throw included (`brokenSignIn`). Without Web Locks the attempt runs at
 * once, its throws read the same way: such a browser does not sync.
 */
export function oneSignInAtATime<T>(
  locks: LockManagerLike | undefined,
  attempt: () => ResultAsync<T, DataError>,
): ResultAsync<T, DataError> {
  return oneTabAtATime(
    locks,
    SIGN_IN_LOCK,
    {
      broken: brokenSignIn,
      unlocked: (cause) => dataError('data:AUTH_FAILED', 'could not take the sign-in lock', cause),
    },
    attempt,
  )
}
