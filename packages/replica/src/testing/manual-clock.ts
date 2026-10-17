import type { Clock } from '../clock'

/** A clock that stands still until a test moves it. */
export interface ManualClock extends Clock {
  /**
   * Moves time forward by `ms`, running every task that falls due on the way in the order of
   * its time, and letting the promise callbacks a task queued run before the next task.
   */
  advance(ms: number): Promise<void>
  /** How many scheduled tasks have neither run nor been cancelled. */
  pending(): number
}

interface Task {
  readonly at: number
  readonly run: () => void
}

/** A manual clock that starts at `start` milliseconds. */
export function manualClock(start = 0): ManualClock {
  let now = start
  // Sorted by time; tasks due at the same time keep the order they were scheduled in.
  const tasks: Task[] = []

  return {
    now: () => now,
    schedule(ms, run) {
      const task = { at: now + ms, run }
      const later = tasks.findIndex((queued) => queued.at > task.at)

      tasks.splice(later === -1 ? tasks.length : later, 0, task)

      return () => {
        const index = tasks.indexOf(task)

        if (index !== -1) {
          tasks.splice(index, 1)
        }
      }
    },
    async advance(ms) {
      const until = now + ms

      for (let task = tasks[0]; task && task.at <= until; task = tasks[0]) {
        tasks.shift()
        now = task.at
        task.run()
        await Promise.resolve()
      }

      now = until
    },
    pending: () => tasks.length,
  }
}
