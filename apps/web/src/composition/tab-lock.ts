/**
 * Work the tabs of a browser run one at a time, under a Web Lock held exclusive from its start to
 * its end. The answer comes once the lock is let go, so nothing that follows runs under it.
 */

import { err, type Result, ResultAsync } from 'neverthrow'

import type { LockManagerLike } from '@workspace/replica/sync'

/** How the work fails when it did not end on its own terms. */
export interface TabLockFailures<E> {
  /** The work threw, or its promise rejected: nothing of the throw is kept, its text may carry a secret. */
  readonly broken: () => E
  /** The lock could not be taken. */
  readonly unlocked: (cause: unknown) => E
}

/** The work's result, a throw or a rejection of it read as `broken`. */
async function settled<T, E>(
  work: () => ResultAsync<T, E>,
  broken: () => E,
): Promise<Result<T, E>> {
  try {
    return await work()
  } catch {
    return err(broken())
  }
}

/**
 * Runs `work` holding the lock `name` exclusive, and answers once the lock is let go, however the
 * work ended, a throw included. Without Web Locks the work runs at once, its throws read the same
 * way: such a browser does not sync.
 */
export function oneTabAtATime<T, E>(
  locks: LockManagerLike | undefined,
  name: string,
  failures: TabLockFailures<E>,
  work: () => ResultAsync<T, E>,
): ResultAsync<T, E> {
  if (!locks) {
    return new ResultAsync(settled(work, failures.broken))
  }

  const released = new Promise<Result<T, E>>((resolve) => {
    let ran = false
    // Called once the lock is let go: the work's result, kept until then.
    let answer = () => resolve(err(failures.broken()))

    locks
      .request(name, { mode: 'exclusive' }, async () => {
        const result = await settled(work, failures.broken)

        ran = true
        answer = () => resolve(result)
      })
      .then(
        () => answer(),
        (cause: unknown) => (ran ? answer() : resolve(err(failures.unlocked(cause)))),
      )
  })

  return new ResultAsync(released)
}
