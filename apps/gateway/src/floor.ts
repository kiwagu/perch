import type { Clock } from '@workspace/replica'

/**
 * Resolves at `deadline` on `clock`, at once when it has passed: an answer that must not come
 * sooner than a floor after its request began waits on it.
 */
export function until(clock: Clock, deadline: number): Promise<void> {
  const remaining = deadline - clock.now()

  return remaining <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        clock.schedule(remaining, resolve)
      })
}
