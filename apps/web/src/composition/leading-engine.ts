import type { DataError } from '@workspace/data'
import type { Clock, RegionDoc } from '@workspace/replica'
import {
  type ChannelState,
  createSyncEngine,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncHints,
  type SyncTransport,
} from '@workspace/replica/sync'

export type Visibility = 'visible' | 'hidden'

/** Whether this tab leads the browser's sync, and the state of its channel to the gateway. */
export interface SyncState {
  readonly leader: boolean
  readonly channel: ChannelState
}

/** The state of a tab that does not lead. */
export const FOLLOWING: SyncState = { leader: false, channel: 'down' }

export interface LeadingEngineOptions {
  /** The region documents an engine syncs, read each time one starts. */
  readonly regions: () => readonly RegionDoc[]
  /** Builds the channel to the gateway for each new engine. */
  readonly transport: () => SyncTransport
  readonly clock: Clock
  /** Who inverse commits of rejected batches are written as: the identity. */
  readonly actor: string
  readonly hints: SyncHints
  readonly replaceRegion: SyncEngineOptions['replaceRegion']
  readonly onState: (state: SyncState) => void
  /** Hears what the current engine reports; what a stopped one reports is dropped. */
  readonly onError: (error: DataError) => void
}

/**
 * The sync engine of a tab while it leads the identity's sync: a new engine over a new channel
 * each time the tab starts to lead (an engine never starts twice), none while another tab leads.
 * A change of the regions replaces it, except while a sign-out drains through it: the regions
 * gone from the space then leave that engine at once (their databases are about to go), and
 * `resume` replaces it once the sign-out ended. Work a stopped engine still had under way fails once the
 * database closes under it; that is not reported: what it did not store, the next leader pulls
 * again.
 */
export class LeadingEngine {
  readonly #options: LeadingEngineOptions
  #engine: SyncEngine | undefined
  /** The regions the current engine syncs, by id. */
  #synced = new Set<string>()
  /** A sign-out drains through the engine: a change of the regions does not replace it. */
  #signingOut = false
  /** The regions changed while a sign-out drained: `resume` replaces the engine. */
  #releadDue = false
  #visibility: Visibility = 'visible'
  #stopped = false

  constructor(options: LeadingEngineOptions) {
    this.#options = options
  }

  /** The engine of this tab, while it leads. */
  get current(): SyncEngine | undefined {
    return this.#engine
  }

  /** This tab starts to lead: a new engine over a new channel. Nothing once stopped. */
  lead(): void {
    if (this.#engine || this.#stopped) {
      return
    }

    const options = this.#options
    const regions = options.regions()
    const engine = createSyncEngine({
      regions,
      transport: options.transport(),
      clock: options.clock,
      actor: options.actor,
      onState: ({ channel }) => {
        if (this.#engine === engine) {
          options.onState({ leader: true, channel })
        }
      },
      onSettled: () => options.hints.post('settled'),
      replaceRegion: options.replaceRegion,
      onError: (error) => {
        if (this.#engine === engine) {
          options.onError(error)
        }
      },
    })

    this.#engine = engine
    this.#synced = new Set(regions.map((region) => region.ref.id))
    engine.visibility(this.#visibility)
    options.onState({ leader: true, channel: 'down' })
    engine.start()
  }

  /**
   * The regions changed: a leading tab replaces its engine with a new one over a new channel; a
   * follower has none. The engine a sign-out drains through stays until it ended (`resume`); the
   * regions gone from the space leave it at once, before their databases go.
   */
  relead(): void {
    const engine = this.#engine

    if (!engine) {
      return
    }

    if (this.#signingOut) {
      const kept = new Set(this.#options.regions().map((region) => region.ref.id))
      const gone = [...this.#synced].filter((id) => !kept.has(id))

      engine.leave(gone)

      for (const id of gone) {
        this.#synced.delete(id)
      }

      this.#releadDue = true

      return
    }

    this.#engine = undefined
    engine.stop()
    this.lead()
  }

  /** Another tab leads now: this one stops syncing. */
  follow(): void {
    const engine = this.#engine

    this.#engine = undefined
    engine?.stop()
    this.#options.onState(FOLLOWING)
  }

  /** The tab was shown or hidden: the engine's cadence follows; a follower tells the leader it is in view. */
  visibility(state: Visibility): void {
    this.#visibility = state

    if (this.#engine) {
      this.#engine.visibility(state)
    } else if (state === 'visible') {
      this.#options.hints.post('visible')
    }
  }

  /** Has the engine sign the device out (`SyncEngine.signOut`); `offline` while this tab does not lead. */
  async signOut(): Promise<'signed-out' | 'offline'> {
    const engine = this.#engine

    if (!engine) {
      return 'offline'
    }

    this.#signingOut = true

    try {
      return await engine.signOut()
    } finally {
      this.#signingOut = false
    }
  }

  /**
   * After a sign-out: a new engine replaces the one that drained when that sign-out asked the
   * gateway in vain, which stopped its channel, or the regions changed while it ran.
   */
  resume(): void {
    if (this.#releadDue || this.#engine?.channelStopped()) {
      this.#releadDue = false
      this.relead()
    }
  }

  /** Stops the engine for good: no new one starts. */
  stop(): void {
    const engine = this.#engine

    this.#stopped = true
    this.#engine = undefined
    engine?.stop()
  }
}
