import { err, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { LockManagerLike } from '@workspace/replica/sync'

/** The Web Lock under which a tab opens the local database `name`. */
export const openLockName = (name: string): string => `perch-open:${name}`

/**
 * Opens a local database holding its open lock exclusive, so the tabs of a browser open one
 * database one at a time. Two engines initialising the same new database at once conflict, and
 * one of the opens fails: a tab following another tab's sign-in, or several tabs opening a new
 * organisation's database, would otherwise race the tab that creates it. Without Web Locks it
 * opens at once.
 */
export function openOneAtATime<T>(
  locks: LockManagerLike | undefined,
  name: string,
  open: () => ResultAsync<T, DataError>,
): ResultAsync<T, DataError> {
  if (!locks) {
    return open()
  }

  const opened = new Promise<Result<T, DataError>>((resolve) => {
    locks
      .request(openLockName(name), { mode: 'exclusive' }, async () => {
        resolve(await open())
      })
      .catch((cause: unknown) => {
        resolve(
          err(dataError('data:OPEN_FAILED', `could not take the open lock of ${name}`, cause)),
        )
      })
  })

  return new ResultAsync(opened)
}
