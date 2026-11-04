import { describe, expect, it } from 'vitest'

import { manualClock } from '../testing'

import { EngineSettling, type SyncedRegion } from './engine-settling'

/**
 * The settling of an engine that holds no region, over a drain that is idle at once unless
 * `idle` holds a wait for its next calls; `ready` answers whether the channel is up.
 */
function settlingOf(options: {
  readonly ready: () => boolean
  readonly idle?: Array<Promise<void>>
}) {
  const clock = manualClock()
  const idle = options.idle ?? []
  const settling = new EngineSettling({
    regions: new Map<string, SyncedRegion>(),
    clock,
    drain: {
      request() {},
      stop() {},
      idle: () => idle.shift() ?? Promise.resolve(),
    },
    onError: () => {},
    ready: options.ready,
  })

  return { settling, clock }
}

/** Lets the checks under way end: each waits for the drain, then for the regions' outboxes. */
function checksEnd(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('engine settling', () => {
  it('stops watching for changes once a wait timed out, however many time out with no change after', async () => {
    const { settling, clock } = settlingOf({ ready: () => false })

    for (let round = 0; round < 3; round += 1) {
      const waits = [
        settling.settled(1_000),
        settling.caughtUp('identity:idn_a', 1_000),
        settling.settled(1_000),
      ]

      await checksEnd()

      expect(settling.watching()).toBe(3)

      await clock.advance(1_000)

      for (const wait of waits) {
        await expect(wait).rejects.toThrow('within 1000 ms')
      }

      expect(settling.watching()).toBe(0)
      expect(clock.pending()).toBe(0)
    }
  })

  it('stops watching once a wait resolves on a change, and cancels its timeout', async () => {
    let ready = false
    const { settling, clock } = settlingOf({ ready: () => ready })
    const settled = settling.settled(1_000)

    await checksEnd()

    expect(settling.watching()).toBe(1)

    ready = true
    settling.changed()
    await settled

    expect(settling.watching()).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  it('checks again when a change came while it checked', async () => {
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // The check that the change interrupts finds the channel down, the next one finds it up.
    const answers = [false, true]
    const { settling } = settlingOf({ ready: () => answers.shift() ?? true, idle: [held] })
    const settled = settling.settled(1_000)

    settling.changed()
    release()
    await settled

    expect(answers).toEqual([])
    expect(settling.watching()).toBe(0)
  })
})
