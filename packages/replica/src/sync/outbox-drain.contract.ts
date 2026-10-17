import { describe, expect, it } from 'vitest'

import type { DrainTarget, OutboxDrainPort } from './outbox-drain'
import type { ChannelState } from './transport'

type MakeDrain = (target: DrainTarget) => OutboxDrainPort

/**
 * An outbox of numbered batches behind a channel that can fall. While held, every push waits
 * until it is released; it counts pushes in flight at the same time.
 */
function fakeOutbox(batches: number) {
  let waiting = batches
  let next = 1
  let calls = 0
  let empties = 0
  let inFlight = 0
  let mostInFlight = 0
  let channel: ChannelState = 'up'
  let gate: Promise<void> | undefined
  let open: (() => void) | undefined
  const pushed: number[] = []
  const target: DrainTarget = {
    async pushNext() {
      calls += 1
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)

      try {
        await gate

        if (channel === 'down') {
          return 'down'
        }

        if (waiting === 0) {
          empties += 1

          return 'empty'
        }

        waiting -= 1
        pushed.push(next)
        next += 1

        return 'sent'
      } finally {
        inFlight -= 1
      }
    },
  }

  return {
    target,
    pushed,
    calls: () => calls,
    empties: () => empties,
    mostInFlight: () => mostInFlight,
    channel(state: ChannelState) {
      channel = state
    },
    hold() {
      gate = new Promise((resolve) => {
        open = resolve
      })
    },
    release() {
      open?.()
      gate = undefined
    },
  }
}

/** Lets every promise callback queued so far, and those they queue, run. */
function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** The behaviour every outbox drain implementation keeps: one batch at a time, rounds on request. */
export function describeOutboxDrain(name: string, make: MakeDrain): void {
  describe(name, () => {
    it('sends one batch at a time until the outbox is empty', async () => {
      const outbox = fakeOutbox(3)
      const drain = make(outbox.target)

      drain.request()
      await drain.idle()

      expect(outbox.pushed).toEqual([1, 2, 3])
      expect(outbox.mostInFlight()).toBe(1)
      expect(outbox.empties()).toBe(1)
    })

    it('folds requests made while draining into one more round', async () => {
      const outbox = fakeOutbox(2)
      const drain = make(outbox.target)

      outbox.hold()
      drain.request()
      await turn()
      drain.request()
      drain.request()
      drain.request()
      outbox.release()
      await drain.idle()

      expect(outbox.pushed).toEqual([1, 2])
      expect(outbox.empties()).toBe(2)
    })

    it('stops on a fallen channel and resumes on the next request', async () => {
      const outbox = fakeOutbox(2)
      const drain = make(outbox.target)

      outbox.channel('down')
      drain.request()
      await drain.idle()

      expect(outbox.calls()).toBe(1)
      expect(outbox.pushed).toEqual([])

      outbox.channel('up')
      drain.request()
      await drain.idle()

      expect(outbox.pushed).toEqual([1, 2])
    })

    it('resolves idle() only when nothing is in flight', async () => {
      const outbox = fakeOutbox(1)
      const drain = make(outbox.target)
      let idle = false

      await drain.idle()
      outbox.hold()
      drain.request()
      void drain.idle().then(() => {
        idle = true
      })
      await turn()

      expect(idle).toBe(false)

      outbox.release()
      await drain.idle()

      expect(idle).toBe(true)
      expect(outbox.pushed).toEqual([1])
    })

    it('runs nothing after stop', async () => {
      const idleOutbox = fakeOutbox(2)
      const stoppedAtOnce = make(idleOutbox.target)

      stoppedAtOnce.stop()
      stoppedAtOnce.request()
      await stoppedAtOnce.idle()

      expect(idleOutbox.calls()).toBe(0)

      const busyOutbox = fakeOutbox(2)
      const stoppedWhileBusy = make(busyOutbox.target)

      busyOutbox.hold()
      stoppedWhileBusy.request()
      await turn()
      stoppedWhileBusy.stop()
      busyOutbox.release()
      await stoppedWhileBusy.idle()

      expect(busyOutbox.calls()).toBe(1)
    })
  })
}
