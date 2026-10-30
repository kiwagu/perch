/**
 * The state of this device's sync, the same in every tab of the browser. Only the tab that leads
 * the sync holds a channel to the gateway, so it shares what only it knows (whether its channel
 * is up, whether changes made on this device wait to be sent, and a sync stopped for good) as a
 * record in the browser's storage, written when its channel changes and every two seconds while
 * it leads; every tab reads that record with its own network. A record nobody refreshed for a few
 * seconds belongs to a leader that went away: the tab that leads next is still connecting.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { SyncStatus, SyncStatusPort } from '../platform/sync-status.port'

import type { SyncState } from './identity-space'
import type { KeyValueStorage } from './storage'

const KEY = 'perch.sync.leader'
const EVERY = 2_000
/** A leader that has not refreshed its record for this long went away. */
const STALE = 3 * EVERY

const leaderSchema = z.object({
  channel: z.enum(['up', 'down']),
  waiting: z.boolean(),
  stopped: z.boolean(),
  at: z.number(),
})

type Leader = z.output<typeof leaderSchema>

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

function readLeader(storage: KeyValueStorage): Leader | undefined {
  const text = storage.get(KEY)

  if (text === undefined) {
    return undefined
  }

  try {
    const read = leaderSchema.safeParse(JSON.parse(text))

    return read.success ? read.data : undefined
  } catch {
    // Not a record this code wrote: there is no leader to read.
    return undefined
  }
}

export function syncStatus(options: SyncStatusOptions): SyncStatusSource {
  const listeners = new Set<() => void>()
  let leading = false
  let channel: Leader['channel'] = 'down'
  let waiting = false
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

    options.storage.set(KEY, JSON.stringify(leader))
  }
  // Whether changes wait, asked again of the open space; what it answers once this tab still leads.
  const check = () => {
    void options.unsent()?.match(
      (unsent) => {
        if (leading && unsent !== waiting) {
          waiting = unsent
          publish()
          notify()
        }
      },
      // Unread: the next tick asks again.
      () => undefined,
    )
  }
  const tick = () => {
    cancel = options.clock.schedule(EVERY, () => {
      if (leading) {
        publish()
        check()
      }

      // A record nobody refreshed goes stale with time alone.
      notify()
      tick()
    })
  }
  const unlistenStorage = options.storage.onChangeElsewhere((key) => {
    if (key === KEY || key === undefined) {
      notify()
    }
  })
  const unlistenNetwork = options.onOnlineChange(notify)

  tick()

  return {
    current(): SyncStatus | undefined {
      if (!options.signedIn()) {
        return undefined
      }

      const leader = readLeader(options.storage)

      if (!options.canSync || options.protocolRefused() || leader?.stopped === true) {
        return 'sync-stopped'
      }

      if (!options.online()) {
        return 'offline'
      }

      if (
        leader === undefined ||
        options.clock.now() - leader.at > STALE ||
        leader.channel === 'down'
      ) {
        return 'connecting'
      }

      return leader.waiting ? 'sending' : 'synced'
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    syncState(state) {
      const led = leading

      leading = state.leader
      channel = state.channel

      if (leading) {
        publish()
        check()
      } else if (led) {
        // This tab no longer leads, signed out or handing over: the next leader writes its own.
        waiting = false
        options.storage.remove(KEY)
      }

      notify()
    },
    stop() {
      cancel()
      unlistenStorage()
      unlistenNetwork()

      if (leading) {
        options.storage.remove(KEY)
      }
    },
  }
}
