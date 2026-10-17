/** Time as the replica's timers see it, so tests can move it by hand. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number
  /** Runs `run` after `ms` milliseconds; the returned function cancels it. */
  schedule(ms: number, run: () => void): () => void
}

/** The wall clock and the runtime's timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(ms, run) {
    const timer = setTimeout(run, ms)

    return () => clearTimeout(timer)
  },
}
