export interface OutboxDrainPort {
  /** Drains now, or once more after the round under way when one is running. */
  request(): void
  stop(): void
  /** Resolves once no round is running. */
  idle(): Promise<void>
}

export interface DrainTarget {
  /**
   * Sends the next batch if one is waiting; resolves when it is acknowledged, rejected or the
   * channel fell. It never rejects: a failure is reported by the target and resolves as `down`.
   */
  pushNext(): Promise<'sent' | 'empty' | 'down'>
}

/**
 * Pushes the outbox one batch at a time until it is empty or the channel falls. Requests made
 * while a round runs fold into one more round after it; a fallen channel ends the round, and
 * the next request starts another.
 */
export function createOutboxDrain(target: DrainTarget): OutboxDrainPort {
  let running: Promise<void> | undefined
  let again = false
  let stopped = false

  async function round(): Promise<void> {
    do {
      again = false

      let outcome: 'sent' | 'empty' | 'down' = 'sent'

      while (outcome === 'sent' && !stopped) {
        outcome = await target.pushNext()
      }
    } while (again && !stopped)
  }

  return {
    request() {
      if (stopped) {
        return
      }

      if (running) {
        again = true

        return
      }

      running = round().finally(() => {
        running = undefined
      })
    },
    stop() {
      stopped = true
    },
    idle() {
      return running ?? Promise.resolve()
    },
  }
}
