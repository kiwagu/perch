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

  /**
   * Runs rounds while requests keep coming. It lets go of `running` in the same continuation
   * that finds no request waiting, so a request made from then on starts a new round.
   */
  async function rounds(): Promise<void> {
    for (;;) {
      again = false

      let outcome: 'sent' | 'empty' | 'down' = 'sent'

      // `request` starts rounds only when not stopped, so this awaits at least once and
      // `running` is set by the time the rounds end.
      while (outcome === 'sent' && !stopped) {
        outcome = await target.pushNext()
      }

      if (!again || stopped) {
        running = undefined

        return
      }
    }
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

      running = rounds()
    },
    stop() {
      stopped = true
    },
    idle() {
      return running ?? Promise.resolve()
    },
  }
}
