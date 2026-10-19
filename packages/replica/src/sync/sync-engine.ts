import type { ResultAsync } from 'neverthrow'
import { match, P } from 'ts-pattern'

import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { ServerMessage } from '../protocol'
import type { RegionDoc } from '../region-doc'
import type { RegionReplacement } from '../region-replacement'

import { type CadencePort, createCadence } from './cadence'
import { EnginePasses } from './engine-passes'
import { EngineRegions } from './engine-regions'
import { EngineSettling } from './engine-settling'
import { EngineSignOut } from './engine-sign-out'
import { createOutboxDrain, type OutboxDrainPort } from './outbox-drain'
import type { ChannelState, EndReason, SyncTransport } from './transport'

export interface SyncEngineOptions {
  readonly regions: readonly RegionDoc[]
  readonly transport: SyncTransport
  readonly clock: Clock
  /** Who inverse commits of rejected batches are written as. */
  readonly actor: string
  readonly onState: (state: { readonly channel: ChannelState }) => void
  /** Imported something from the server. */
  readonly onSettled: () => void
  readonly onError: (error: DataError) => void
  /** How many outbox rows one push of a region carries at most; 256 by default, the protocol's limit. */
  readonly batchRows?: number
  /**
   * The document that takes a region's place: `reset` when the gateway refused its batch again
   * after the rollback (the engine then loads the region from the server), `reopen` when another
   * tab reset it. A failure stops that region's sync and is reported.
   */
  readonly replaceRegion: (
    region: RegionDoc,
    how: RegionReplacement,
  ) => ResultAsync<RegionDoc, DataError>
}

export interface SyncEngine {
  start(): void
  stop(): void
  visibility(state: 'visible' | 'hidden'): void
  /** A local write happened (here or, via a hint, in another tab): drain now. */
  localWrite(): void
  /**
   * Resolves once the channel is up, every region has had its first answer on this connection,
   * the outbox is empty and every local update is durable, nothing waits for an answer (a push,
   * a pull, a probe, a compaction), no pass runs and no message is being handled; rejects after
   * `timeoutMs` on the clock. A region that stopped syncing counts as settled: its failure was
   * reported. An update that cannot be made durable is reported once, and is never settled.
   */
  settled(timeoutMs: number): Promise<void>
  /**
   * Waits up to 5 seconds for the channel, drains for up to 10 seconds, then asks the gateway to
   * sign this device out; resolves `signed-out` only when the gateway ended the channel with the
   * sign-out close, which means the grant is revoked. Any other close after the sign-out was
   * asked for (a gateway that could not revoke the grant closes as failed), or no close within
   * 10 seconds, resolves `offline`, the transport stopped so that no reconnect follows.
   * Resolves `offline`, without asking the gateway, when the channel stayed down, fell, the
   * outbox did not drain in time, or a region that stopped syncing still holds what it has not
   * sent. Never rejects.
   */
  signOut(): Promise<'signed-out' | 'offline'>
  /**
   * Whether a sign-out stopped this engine's channel: it asked the gateway, which then did not
   * sign the device out. The engine syncs no more; a new engine over a new channel does.
   */
  channelStopped(): boolean
  /**
   * Connects again at once: the gateway welcomes the device anew and hands it fresh keys. A
   * connection the gateway has not welcomed yet is left to the hello it says.
   */
  reconnect(): void
}

class Engine implements SyncEngine {
  readonly #options: SyncEngineOptions
  readonly #regions: EngineRegions
  readonly #drain: OutboxDrainPort
  readonly #cadence: CadencePort
  readonly #settling: EngineSettling
  readonly #passes: EnginePasses
  readonly #signOutFlow: EngineSignOut
  #listening: Array<() => void> = []
  #channel: ChannelState = 'down'

  constructor(options: SyncEngineOptions) {
    this.#options = options
    this.#regions = new EngineRegions({
      ...options,
      track: (replaced) => this.#settling.track(replaced),
      drain: () => this.#drain.request(),
      changed: () => this.#settling.changed(),
    })
    this.#drain = createOutboxDrain({ pushNext: () => this.#regions.pushNext() })
    this.#settling = new EngineSettling({
      regions: this.#regions.map,
      clock: options.clock,
      drain: this.#drain,
      onError: options.onError,
      ready: () => this.#channel === 'up' && this.#passes.idle(),
    })
    this.#passes = new EnginePasses({
      regions: this.#regions.map,
      transport: options.transport,
      clock: options.clock,
      drain: this.#drain,
      onError: options.onError,
      changed: () => this.#settling.changed(),
    })
    this.#cadence = createCadence(options.clock, (kind) => this.#passes.run(kind))
    this.#signOutFlow = new EngineSignOut({
      transport: options.transport,
      clock: options.clock,
      drain: this.#drain,
      settling: this.#settling,
      up: () => this.#channel === 'up',
    })
  }

  start(): void {
    if (this.#listening.length > 0) {
      return
    }

    const transport = this.#options.transport

    this.#listening = [
      transport.onMessage((message) => this.#receive(message)),
      transport.onChannel((state) => this.#channelChanged(state)),
      transport.onEnded((reason) => this.#ended(reason)),
    ]
    this.#cadence.start()
    transport.start()
  }

  stop(): void {
    this.#regions.stop()
    this.#cadence.stop()
    this.#drain.stop()
    this.#options.transport.stop()

    for (const unlisten of this.#listening.splice(0)) {
      unlisten()
    }

    for (const { sync } of this.#regions.map.values()) {
      sync.channelDown()
    }

    this.#channel = 'down'
    this.#passes.forgetProbes()
    this.#settling.changed()
  }

  visibility(state: 'visible' | 'hidden'): void {
    this.#cadence.visibility(state)
  }

  localWrite(): void {
    this.#drain.request()
  }

  settled(timeoutMs: number): Promise<void> {
    return this.#settling.settled(timeoutMs)
  }

  channelStopped(): boolean {
    return this.#signOutFlow.channelStopped()
  }

  reconnect(): void {
    this.#options.transport.reconnect()
  }

  signOut(): Promise<'signed-out' | 'offline'> {
    return this.#signOutFlow.run()
  }

  #receive(message: ServerMessage): void {
    match(message)
      .with({ type: 'welcome' }, () => {
        for (const { sync } of this.#regions.map.values()) {
          sync.subscribe()
        }
      })
      // The transport hands renewed keys and memberships to the app.
      .with({ type: P.union('tokens', 'memberships') }, () => {})
      .with({ type: 'heads' }, ({ regions }) => {
        this.#passes.answered()

        for (const { region, head } of regions) {
          this.#regions.map.get(region)?.sync.catchUp(head)
        }

        this.#settling.changed()
      })
      .with({ type: 'error' }, (error) => {
        this.#options.onError(
          dataError(
            'data:QUERY_FAILED',
            `the gateway answered with a ${error.code} error: ${error.message}`,
          ),
        )

        // An error names no request: each region gives up what waits for an answer.
        for (const { sync } of this.#regions.map.values()) {
          this.#settling.track(sync.handle(error))
        }
      })
      .with({ type: P.union('updates', 'ack', 'reject', 'compaction') }, (regional) => {
        const synced = this.#regions.map.get(regional.region)

        if (synced) {
          this.#settling.track(synced.sync.handle(regional))
        } else {
          this.#options.onError(
            dataError(
              'data:QUERY_FAILED',
              `the gateway sent ${regional.type} for ${regional.region}, which this device does not sync`,
            ),
          )
        }
      })
      .exhaustive()
  }

  /**
   * The channel ended for good. A refused protocol stops syncing and is reported: this
   * application is older than the gateway, and only a reload brings one that speaks its
   * protocol; nothing on the device changes. A device signed out from another one stops syncing
   * without a report: the transport tells the app, whose keys no longer work. Refused keys and a
   * sign-out are the app's to act on.
   */
  #ended(reason: EndReason): void {
    match(reason)
      .with('protocol', () => {
        this.#stopPasses()
        this.#options.onError(
          dataError(
            'data:SYNC_STOPPED',
            'the gateway refused the protocol; reload the application',
          ),
        )
      })
      .with('revoked', () => this.#stopPasses())
      .with(P.union('unauthorized', 'signed-out'), () => {})
      .exhaustive()
  }

  /** No pass and no drain runs any more: the channel will not come back. */
  #stopPasses(): void {
    this.#cadence.stop()
    this.#drain.stop()
  }

  #channelChanged(state: ChannelState): void {
    this.#channel = state

    if (state === 'down') {
      this.#passes.forgetProbes()

      for (const { sync } of this.#regions.map.values()) {
        sync.channelDown()
      }
    }

    this.#cadence.channel(state)
    this.#options.onState({ channel: state })
    this.#settling.changed()
  }
}

/**
 * Syncs the given region documents with the gateway: one `RegionSync` per region over one
 * transport, the outbox drained on every local write and full pass, and passes on a cadence
 * that follows the tab's visibility and the channel.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  return new Engine(options)
}
