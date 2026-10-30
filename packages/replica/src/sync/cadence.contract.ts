import { describe, expect, it } from 'vitest'

import { type ManualClock, manualClock } from '../testing'

import type { CadencePort, PassKind } from './cadence'
import type { ChannelState } from './transport'

type MakeCadence = (clock: ManualClock, pass: (kind: PassKind) => Promise<void>) => CadencePort

interface StartState {
  readonly visible: boolean
  readonly channel: ChannelState
}

interface PassOptions {
  /** How long each pass takes on the clock; passes finish at once by default. */
  readonly passTakesMs?: number
}

/**
 * A cadence put into a state before it starts, then started: the state it is put into runs no
 * pass, and neither does the start. It records each pass it runs and counts passes that ran
 * while another had not finished.
 */
function started(make: MakeCadence, state: StartState, options: PassOptions = {}) {
  const clock = manualClock()
  const passes: PassKind[] = []
  let running = 0
  let overlaps = 0
  const cadence = make(clock, async (kind) => {
    passes.push(kind)
    running += 1

    if (running > 1) {
      overlaps += 1
    }

    const takes = options.passTakesMs

    if (takes !== undefined) {
      await new Promise<void>((resolve) => clock.schedule(takes, resolve))
    }

    running -= 1
  })

  cadence.visibility(state.visible ? 'visible' : 'hidden')
  cadence.channel(state.channel)
  cadence.start()

  return { clock, passes, cadence, overlaps: () => overlaps }
}

/** The behaviour every cadence implementation keeps: when it probes, when it runs a full pass. */
export function describeCadence(name: string, make: MakeCadence): void {
  describe(name, () => {
    it('probes every minute while visible and connected', async () => {
      const { clock, passes } = started(make, { visible: true, channel: 'up' })

      await clock.advance(180_000)

      expect(passes.filter((kind) => kind === 'probe').length).toBe(3)
    })

    it('probes every 15 seconds while the channel is down', async () => {
      const { clock, passes } = started(make, { visible: true, channel: 'down' })

      await clock.advance(60_000)

      expect(passes.length).toBe(4)
    })

    it('probes every 5 minutes while hidden', async () => {
      const { clock, passes } = started(make, { visible: false, channel: 'up' })

      await clock.advance(600_000)

      expect(passes.length).toBe(2)
    })

    it('runs a full pass every 5 minutes', async () => {
      const { clock, passes } = started(make, { visible: true, channel: 'up' })

      await clock.advance(600_000)

      expect(passes.filter((kind) => kind === 'full').length).toBe(2)
    })

    it('catches up at once when the tab becomes visible, and echoes after 5 seconds', async () => {
      const { clock, passes, cadence } = started(make, { visible: false, channel: 'up' })

      cadence.visibility('visible')
      await clock.advance(0)

      expect(passes).toEqual(['full'])

      await clock.advance(5_000)

      expect(passes).toEqual(['full', 'full'])
    })

    it('catches up at once when the channel comes up', async () => {
      const { clock, passes, cadence } = started(make, { visible: true, channel: 'down' })

      cadence.channel('up')
      await clock.advance(0)

      expect(passes[0]).toBe('full')
    })

    it('runs nothing after stop', async () => {
      const { clock, passes, cadence } = started(make, { visible: true, channel: 'up' })

      cadence.stop()
      await clock.advance(600_000)

      expect(passes).toEqual([])
    })

    it('never runs two passes at once', async () => {
      const { clock, overlaps } = started(
        make,
        { visible: true, channel: 'down' },
        { passTakesMs: 20_000 },
      )

      await clock.advance(120_000)

      expect(overlaps()).toBe(0)
    })

    it('runs a pass that fell due during another as soon as that one finishes', async () => {
      const { clock, passes } = started(
        make,
        { visible: true, channel: 'down' },
        { passTakesMs: 20_000 },
      )

      // The first probe runs from 15 to 35 seconds; the next falls due at 30.
      await clock.advance(30_000)

      expect(passes).toEqual(['probe'])

      await clock.advance(5_000)
      await clock.advance(0)

      expect(passes).toEqual(['probe', 'probe'])
    })
  })
}
