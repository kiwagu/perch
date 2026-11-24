/**
 * The state of this device's sync, the same in every tab of the browser. Only the tab that leads
 * the sync holds a channel to the gateway, so it shares what only it knows (whether its channel
 * is up, whether changes made on this device wait to be sent, and a sync stopped for good) as a
 * record in the browser's storage, written when its channel changes and every two seconds while
 * it leads; every tab reads that record with its own network. The browser may hold back the
 * timers of a hidden tab (Chrome, once it has been hidden for minutes, to one wake-up a minute),
 * and the leader's two-second beat with them, but not what the tab hears: a tab that has not heard
 * the leader for a while asks it for its beat, and the leader answers. A leader not heard for a few
 * seconds, which did not answer either, went away: the tab that leads next is still connecting.
 * How long a tab has not heard the leader is measured on its steady clock, which setting the wall
 * clock does not move; the wall clock only dates a record the tab has not heard written.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { Clock } from '@workspace/replica'

import type { SyncStatus, SyncStatusPort } from '../platform/sync-status.port'

import type { SyncState } from './identity-space'
import type { VisibilitySource } from './session'
import {
  askSyncLeader,
  forgetSyncLeader,
  type KeyValueStorage,
  type SyncLeader as Leader,
  SYNC_ASK_KEY,
  SYNC_LEADER_KEY,
  savedSyncLeader,
  saveSyncLeader,
} from './storage'

const EVERY = 2_000
/** A leader not heard for this long missed a beat: a tab asks it for one. */
const LATE = EVERY + EVERY / 2
/** A leader not heard for this long, which did not answer when asked either, went away. */
const STALE = 3 * EVERY

export interface SyncStatusOptions {
  readonly storage: KeyValueStorage
  readonly clock: Clock
  /** Whether the browser says it has a network, and how to hear that it changed. */
  readonly online: () => boolean
  readonly onOnlineChange: (listener: () => void) => () => void
  /** Whether an account is signed in on this device now. */
  readonly signedIn: () => boolean
  /** Whether the open space holds changes not sent yet; none while no space is open. */
  readonly unsent: () => ResultAsync<boolean, DataError> | undefined
  /** Whether the gateway refused the sync protocol of this build since the page loaded. */
  readonly protocolRefused: () => boolean
  /** Whether this browser can lead a sync at all: without Web Locks no tab does. */
  readonly canSync: boolean
  /** Whether this tab is in view: one that comes back asks a late leader at once. */
  readonly visibility: VisibilitySource
  /** Milliseconds on this tab's steady clock (`performance.now()`), which setting the wall clock does not move. */
  readonly steady: () => number
}

export interface SyncStatusSource extends SyncStatusPort {
  /** Hears the sync state of this tab's space: whether it leads, and its channel. */
  syncState(state: SyncState): void
  /** Stops the timer and the listeners; a leader's record goes. */
  stop(): void
}

export function syncStatus(options: SyncStatusOptions): SyncStatusSource {
  const listeners = new Set<() => void>()
  let leading = false
  let channel: Leader['channel'] = 'down'
  let waiting: Leader['waiting'] = null
  // Moves on each time this tab starts or stops leading, and when the source stops: a read of the
  // outbox answers only the period it was asked in, and only while it is the latest one asked.
  let period = 0
  let asked = 0
  // On this tab's steady clock: when the leader wrote the newest record this tab heard of, and when
  // this tab first asked for a beat no fresh word has answered since, however often it is sent.
  let heard: number | undefined
  let askedAt: number | undefined
  // The time of the record this tab wrote last: each one later than the one before, so that every
  // write is a change the other tabs hear of, within one millisecond or with the clock set back.
  let wrote = -Infinity
  let stopped = false
  let cancel = () => {}
  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  const publish = () => {
    wrote = Math.max(options.clock.now(), wrote + 1)

    const leader: Leader = {
      channel,
      waiting,
      stopped: options.protocolRefused(),
      at: wrote,
    }

    saveSyncLeader(options.storage, leader)
  }
  const answer = (next: Leader['waiting']) => {
    if (next !== waiting) {
      waiting = next
      publish()
      notify()
    }
  }
  // Whether changes wait, asked again of the open space. An answer counts only in the leading
  // period it was asked in and while no later question was asked; a failed read leaves it unknown.
  const check = () => {
    const reading = options.unsent()

    if (reading === undefined) {
      return
    }

    const mine = { period, question: ++asked }
    const current = () => !stopped && leading && mine.period === period && mine.question === asked

    void reading.match(
      (unsent) => {
        if (current()) {
          answer(unsent)
        }
      },
      () => {
        if (current()) {
          answer(null)
        }
      },
    )
  }
  // What the leading tab does every two seconds, and when another tab asks for it.
  const beat = () => {
    publish()
    check()
  }
  // When the leader wrote `leader`, on this tab's steady clock: its age read off the wall clock now.
  // None for a record dated after now, written while the clock stood further on.
  const writtenAt = (leader: Leader) => {
    const age = options.clock.now() - leader.at

    return age >= 0 ? options.steady() - age : undefined
  }
  // The leader wrote, and this tab heard of it: a word dated by the record's own time, so the late
  // news of an old write is no fresh word; one dated after now was written as the clock was set
  // back, just now. A fresh word answers whatever this tab asked.
  const hear = (leader: Leader) => {
    const at = writtenAt(leader) ?? options.steady()

    heard = Math.max(heard ?? at, at)

    if (options.steady() - at < EVERY) {
      askedAt = undefined
    }
  }
  // How long this tab has not heard the leader.
  const silence = () => (heard === undefined ? Infinity : options.steady() - heard)
  // A tab that does not lead asks for a beat when it has not heard the leader for a while.
  const ask = () => {
    if (leading || savedSyncLeader(options.storage) === undefined || silence() <= LATE) {
      return
    }

    askedAt ??= options.steady()
    askSyncLeader(options.storage, options.clock.now())
  }
  // A leader not heard for long went away, unless this tab asked it for a beat less than a beat
  // ago and the answer may still be on the way. The leading tab is not gone to itself.
  const gone = () => {
    const answering = askedAt !== undefined && options.steady() - askedAt < EVERY

    return !leading && silence() > STALE && !answering
  }
  const tick = () => {
    cancel = options.clock.schedule(EVERY, () => {
      if (leading) {
        beat()
      } else {
        ask()
      }

      // A record nobody refreshed goes stale with time alone.
      notify()
      tick()
    })
  }
  const unlistenStorage = options.storage.onChangeElsewhere((key) => {
    if (key === SYNC_ASK_KEY) {
      // Another tab found the record late: the browser held this tab's timers back, not its ears.
      if (leading) {
        beat()
      }
    } else if (key === SYNC_LEADER_KEY || key === undefined) {
      const leader = key === undefined ? undefined : savedSyncLeader(options.storage)

      // A record removed is no word of the leader.
      if (leader !== undefined) {
        hear(leader)
      }

      notify()
    }
  })
  const unlistenNetwork = options.onOnlineChange(notify)
  // A tab coming back into view may be read before its timers catch up: it asks at once.
  const unlistenVisibility = options.visibility.onChange((state) => {
    if (state === 'visible') {
      ask()
      notify()
    }
  })

  // The record the tab finds when it starts, dated by its own time; one dated after now (the clock
  // was set back since) has no known age until the leader is heard.
  const found = savedSyncLeader(options.storage)

  if (found !== undefined) {
    heard = writtenAt(found) ?? -Infinity
  }

  ask()
  tick()

  return {
    current(): SyncStatus | undefined {
      if (!options.signedIn()) {
        return undefined
      }

      const leader = savedSyncLeader(options.storage)

      if (!options.canSync || options.protocolRefused() || leader?.stopped === true) {
        return 'sync-stopped'
      }

      if (!options.online()) {
        return 'offline'
      }

      if (leader === undefined || gone() || leader.channel === 'down') {
        return 'connecting'
      }

      // Synced only once a read of the outbox found nothing waiting.
      return leader.waiting === false ? 'synced' : 'sending'
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    syncState(state) {
      if (stopped) {
        return
      }

      const led = leading

      leading = state.leader
      channel = state.channel

      if (leading !== led) {
        // A new leading period, or none: what the outbox said before is not known any more.
        period += 1
        waiting = null
      }

      if (leading) {
        publish()
        check()
      } else if (led) {
        // This tab no longer leads, signed out or handing over: the next leader writes its own.
        forgetSyncLeader(options.storage)
      }

      notify()
    },
    stop() {
      if (stopped) {
        return
      }

      stopped = true
      period += 1
      cancel()
      unlistenStorage()
      unlistenNetwork()
      unlistenVisibility()

      if (leading) {
        leading = false
        forgetSyncLeader(options.storage)
      }
    },
  }
}
