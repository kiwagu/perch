import type { Clock } from '../clock'

import type { ChannelState } from './transport'

/** A probe asks the gateway for the heads of the regions; a full pass also drains and pulls. */
export type PassKind = 'probe' | 'full'

export interface CadencePort {
  start(): void
  stop(): void
  visibility(state: 'visible' | 'hidden'): void
  channel(state: ChannelState): void
}

/**
 * How often passes run: a probe every minute while the tab is visible and the channel up,
 * every 15 seconds while the channel is down, every 5 minutes while the tab is hidden; a full
 * pass every 5 minutes, and an echo 5 seconds after an immediate catch-up.
 */
export const CADENCE_MS = {
  visibleUp: 60_000,
  down: 15_000,
  hidden: 300_000,
  full: 300_000,
  echo: 5_000,
} as const

const NOTHING_SCHEDULED = (): void => {}

/**
 * Runs sync passes over an injected clock. Every pass probes, so the next probe counts from
 * the last pass; a full pass falls due 5 minutes after the last full pass and takes the place
 * of a probe due at the same time. The tab becoming visible or the channel coming up catches
 * up at once with a full pass and echoes it 5 seconds later. One pass runs at a time: a pass
 * that falls due meanwhile runs once the current one has finished. A state set before
 * `start` runs nothing.
 */
export function createCadence(clock: Clock, pass: (kind: PassKind) => Promise<void>): CadencePort {
  let started = false
  let visible = true
  let channel: ChannelState = 'down'
  let running = false
  /** The pass that fell due while another ran; a full pass covers a probe. */
  let queued: PassKind | undefined
  let lastPass = 0
  let lastFull = 0
  let cancelNext = NOTHING_SCHEDULED
  let cancelEcho = NOTHING_SCHEDULED

  function probeInterval(): number {
    if (!visible) {
      return CADENCE_MS.hidden
    }

    return channel === 'up' ? CADENCE_MS.visibleUp : CADENCE_MS.down
  }

  /** Schedules whichever pass falls due first after the last ones. */
  function scheduleNext(): void {
    cancelNext()

    const probeAt = lastPass + probeInterval()
    const fullAt = lastFull + CADENCE_MS.full
    const at = Math.min(probeAt, fullAt)

    cancelNext = clock.schedule(Math.max(0, at - clock.now()), () => {
      cancelNext = NOTHING_SCHEDULED
      run(clock.now() >= fullAt ? 'full' : 'probe')
    })
  }

  function run(kind: PassKind): void {
    if (!started) {
      return
    }

    if (running) {
      queued = queued === 'full' ? 'full' : kind

      return
    }

    running = true
    lastPass = clock.now()

    if (kind === 'full') {
      lastFull = lastPass
    }

    scheduleNext()
    void pass(kind).finally(() => {
      running = false

      const next = queued

      queued = undefined

      if (next) {
        run(next)
      }
    })
  }

  function catchUp(): void {
    run('full')
    cancelEcho()
    cancelEcho = clock.schedule(CADENCE_MS.echo, () => {
      cancelEcho = NOTHING_SCHEDULED
      run('full')
    })
  }

  return {
    start() {
      if (started) {
        return
      }

      started = true
      lastPass = clock.now()
      lastFull = lastPass
      scheduleNext()
    },
    stop() {
      started = false
      queued = undefined
      cancelNext()
      cancelEcho()
      cancelNext = NOTHING_SCHEDULED
      cancelEcho = NOTHING_SCHEDULED
    },
    visibility(state) {
      const wasVisible = visible

      visible = state === 'visible'

      if (!started || wasVisible === visible) {
        return
      }

      if (visible) {
        catchUp()
      } else {
        scheduleNext()
      }
    },
    channel(state) {
      const was = channel

      channel = state

      if (!started || was === state) {
        return
      }

      if (state === 'up') {
        catchUp()
      } else {
        scheduleNext()
      }
    },
  }
}
