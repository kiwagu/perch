/**
 * This tab's part in the sync of an identity's space: it leads or follows as the leadership
 * says, hears what the identity's other tabs tell it, and catches up with what they wrote.
 */

import { type DataError, dataError } from '@workspace/data'
import type { Leadership, SyncHint, SyncHints } from '@workspace/replica/sync'

import type { RegionSpace } from '../tenant-space'

import { FOLLOWING, type LeadingEngine, type SyncState } from './leading-engine'
import type { RegionReloads } from './region-reloads'

export interface TabSyncOptions {
  readonly leading: LeadingEngine
  readonly leadership: Leadership | undefined
  readonly hints: SyncHints
  readonly reloads: RegionReloads
  /** The identity's own region first, then each organisation's. */
  readonly spaces: () => readonly RegionSpace[]
  /** Whether the space is closing: it catches up no more. */
  readonly closing: () => boolean
  /** Opens a region again when `error` says it was reset under this tab. */
  readonly stale: (error: DataError) => void
  readonly onState: (state: SyncState) => void
  readonly onError: (error: DataError) => void
}

export class TabSync {
  readonly #leading: LeadingEngine
  readonly #hints: SyncHints
  readonly #reloads: RegionReloads
  readonly #spaces: () => readonly RegionSpace[]
  readonly #closing: () => boolean
  readonly #stale: (error: DataError) => void
  readonly #onState: (state: SyncState) => void
  readonly #onError: (error: DataError) => void
  readonly #listening: Array<() => void> = []

  constructor(options: TabSyncOptions) {
    this.#leading = options.leading
    this.#hints = options.hints
    this.#reloads = options.reloads
    this.#spaces = options.spaces
    this.#closing = options.closing
    this.#stale = options.stale
    this.#onState = options.onState
    this.#onError = options.onError
    this.#listening.push(options.hints.on((hint) => this.#hint(hint)))
    this.#followLeadership(options.leadership)
  }

  /** A write of this tab is durable: the leader drains it, the other tabs read it from the log. */
  wrote(): void {
    this.#leading.current?.localWrite()
    this.#hints.post('journal')
  }

  /** Stops hearing the leadership and the other tabs. */
  stop(): void {
    for (const stop of this.#listening.splice(0)) {
      stop()
    }
  }

  #followLeadership(leadership: Leadership | undefined): void {
    if (!leadership) {
      this.#onError(
        dataError(
          'data:SYNC_STOPPED',
          'Web Locks are not available in this browser, so no tab can lead the sync: this device does not sync',
        ),
      )
      this.#onState(FOLLOWING)

      return
    }

    this.#listening.push(
      leadership.onChange((leader) => (leader ? this.#leading.lead() : this.#leading.follow())),
    )

    if (leadership.isLeader()) {
      this.#leading.lead()
    } else {
      this.#onState(FOLLOWING)
    }
  }

  #hint(hint: SyncHint): void {
    switch (hint) {
      // Another tab wrote to the log: read it, and drain it when leading.
      case 'journal':
        this.#catchUp()
        this.#leading.current?.localWrite()
        break
      // The leader imported from the gateway into the log.
      case 'settled':
        this.#catchUp()
        break
      case 'visible':
        this.#leading.current?.visibility('visible')
        break
      case 'kick':
        this.#leading.current?.localWrite()
        break
      // Another tab began a sign-out: the session holds this tab's writes back.
      case 'sign-out':
        break
      // Another tab needs new keys: the leader asks the gateway for them over its channel.
      case 'renew':
        this.#leading.current?.renew()
        break
      // Another tab reset a region: open it again from the database.
      case 'reset':
        void this.#reloads.reloadStale()
        break
    }
  }

  #catchUp(): void {
    if (this.#closing()) {
      return
    }

    for (const space of this.#spaces()) {
      void space.catchUp().match(
        () => undefined,
        (error) => {
          this.#onError(error)
          this.#stale(error)
        },
      )
    }
  }
}
