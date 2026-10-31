/**
 * The Web Lock that runs the sign-ins of a browser's tabs one at a time, from the request to the
 * gateway to the saved device. The gateway keeps one session per device, so a later sign-in ends
 * the device's earlier session: asked only once the earlier sign-in saved its token, the later one
 * replaces it in the storage with the live one, and no live token is left without a tab keeping
 * it or a sign-out queued for it.
 */

import { err, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { LockManagerLike } from '@workspace/replica/sync'

/** The lock every tab's sign-in holds exclusive. */
export const SIGN_IN_LOCK = 'perch.session.sign-in'

/**
 * A sign-in that threw rather than failing. Nothing of the throw is kept: its text may carry a
 * token.
 */
export const brokenSignIn = (): DataError =>
  dataError('data:AUTH_FAILED', 'the sign-in could not be completed')

/** The attempt's result, a throw or a rejection of it read as `brokenSignIn`. */
async function settled<T>(attempt: () => ResultAsync<T, DataError>): Promise<Result<T, DataError>> {
  try {
    return await attempt()
  } catch {
    return err(brokenSignIn())
  }
}

/**
 * Runs `attempt` holding the sign-in lock exclusive, and answers once the lock is let go, however
 * the attempt ended, a throw included (`brokenSignIn`). Without Web Locks the attempt runs at
 * once, its throws read the same way: such a browser does not sync.
 */
export function oneSignInAtATime<T>(
  locks: LockManagerLike | undefined,
  attempt: () => ResultAsync<T, DataError>,
): ResultAsync<T, DataError> {
  if (!locks) {
    return new ResultAsync(settled(attempt))
  }

  const released = new Promise<Result<T, DataError>>((resolve) => {
    let ran = false
    // Called once the lock is let go: the attempt's result, kept until then.
    let answer = () => resolve(err(brokenSignIn()))

    locks
      .request(SIGN_IN_LOCK, { mode: 'exclusive' }, async () => {
        const result = await settled(attempt)

        ran = true
        answer = () => resolve(result)
      })
      .then(
        () => answer(),
        (cause: unknown) =>
          ran
            ? answer()
            : resolve(err(dataError('data:AUTH_FAILED', 'could not take the sign-in lock', cause))),
      )
  })

  return new ResultAsync(released)
}
