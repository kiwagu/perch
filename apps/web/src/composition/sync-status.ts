/**
 * The state of this device's sync, the same in every tab of the browser. Only the tab that leads
 * the sync holds a channel to the gateway, so it shares what only it knows (whether its channel
 * is up, whether changes made on this device wait to be sent, and a sync stopped for good) as a
 * record in the browser's storage, written when its channel changes and every two seconds while
 * it leads; every tab reads that record with its own network. The browser may hold back the
 * timers of a hidden tab (Chrome, once it has been hidden for minutes, to one wake-up a minute),
 * and the leader's two-second beat with them, but not what the tab hears: a tab that finds the
 * record late asks the leader for its beat, and the leader answers. A record nobody refreshed for
 * a few seconds, whose leader did not answer either, belongs to a leader that went away: the tab
 * that leads next is still connecting.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { Clock } from '@workspace/replica'

import type { SyncStatus, SyncStatusPort } from '../platform/sync-status.port'

import type { SyncState } from './identity-space'
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
/** A record older than this missed a beat of its leader: a tab that reads it asks for one. */
const LATE = EVERY + EVERY / 2
/** A leader that has not refreshed its record for this long, nor answered when asked, went away. */
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
  // When this tab asked the leader for a beat it has not answered since (a record written then or
  // later answers it): the first such ask, however often it is sent again.
  let askedAt: number | undefined
  let stopped = false
  let cancel = () => {}
  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  const publish = () => {
    const leader: Leader = {
      channel,
      waiting,
      stopped: options.protocolRefused(),
      at: options.clock.now(),
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
  // A tab that does not lead asks for a beat when the record is late.
  const ask = () => {
    const leader = savedSyncLeader(options.storage)
    const now = options.clock.now()

    if (leading || leader === undefined || now - leader.at <= LATE) {
      return
    }

    if (askedAt === undefined || askedAt <= leader.at) {
      askedAt = now
    }

    askSyncLeader(options.storage, now)
  }
  // A stale record belongs to a leader that went away, unless this tab asked it for a beat less
  // than a beat ago and its answer may still be on the way.
  const gone = (leader: Leader) => {
    const now = options.clock.now()
    const answering = askedAt !== undefined && askedAt > leader.at && now - askedAt < EVERY

    return now - leader.at > STALE && !answering
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
      notify()
    }
  })
  const unlistenNetwork = options.onOnlineChange(notify)

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

      if (leader === undefined || gone(leader) || leader.channel === 'down') {
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

      if (leading) {
        leading = false
        forgetSyncLeader(options.storage)
      }
    },
  }
}
