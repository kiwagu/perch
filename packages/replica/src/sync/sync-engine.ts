import { okAsync } from 'neverthrow'
import { match, P } from 'ts-pattern'

import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { ServerMessage } from '../protocol'
import type { RegionDoc } from '../region-doc'

import { type CadencePort, createCadence, type PassKind } from './cadence'
import { createOutboxDrain, type OutboxDrainPort } from './outbox-drain'
import { RegionSync } from './region-sync'
import type { ChannelState, SyncTransport } from './transport'

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
}

export interface SyncEngine {
  start(): void
  stop(): void
  visibility(state: 'visible' | 'hidden'): void
  /** A local write happened (here or, via a hint, in another tab): drain now. */
  localWrite(): void
  /**
   * Resolves once the channel is up, every region has had its first answer on this connection,
   * the outbox is empty, nothing waits for an answer (a push, a pull, a probe, a compaction),
   * no pass runs and no message is being handled; rejects after `timeoutMs` on the clock. A
   * region that stopped syncing counts as settled: its failure was reported.
   */
  settled(timeoutMs: number): Promise<void>
  /**
   * Waits up to 5 seconds for the channel, drains, then asks the gateway to sign this device
   * out; resolves when the gateway ended the channel, or `offline` when the channel stayed
   * down or fell.
   */
  signOut(): Promise<'signed-out' | 'offline'>
}

/** How long a sign-out waits for the channel to come up. */
const SIGN_OUT_CHANNEL_MS = 5_000

/** How long a sign-out waits for the outbox to drain. */
const SIGN_OUT_SETTLE_MS = 10_000

interface SyncedRegion {
  readonly region: RegionDoc
  readonly sync: RegionSync
}

/** A promise that the next `fire` resolves, renewed each time. */
function changeSignal() {
  let resolve: () => void = () => {}
  let next = new Promise<void>((settle) => {
    resolve = settle
  })

  return {
    next: () => next,
    fire() {
      resolve()
      next = new Promise<void>((settle) => {
        resolve = settle
      })
    },
  }
}

class Engine implements SyncEngine {
  readonly #options: SyncEngineOptions
  readonly #regions: ReadonlyMap<string, SyncedRegion>
  readonly #drain: OutboxDrainPort
  readonly #cadence: CadencePort
  readonly #change = changeSignal()
  #listening: Array<() => void> = []
  #channel: ChannelState = 'down'
  /** Server messages handed to a region and not yet handled. */
  #handling = 0
  /** Probes sent on this connection whose heads have not arrived. */
  #probing = 0
  #passing = false

  constructor(options: SyncEngineOptions) {
    this.#options = options
    this.#regions = new Map(
      options.regions.map((region) => [
        region.ref.id,
        {
          region,
          sync: new RegionSync({
            region,
            transport: options.transport,
            actor: options.actor,
            onSettled: options.onSettled,
            onError: options.onError,
          }),
        },
      ]),
    )
    this.#drain = createOutboxDrain({ pushNext: () => this.#pushNext() })
    this.#cadence = createCadence(options.clock, (kind) => this.#pass(kind))
  }

  start(): void {
    if (this.#listening.length > 0) {
      return
    }

    const transport = this.#options.transport

    this.#listening = [
      transport.onMessage((message) => this.#receive(message)),
      transport.onChannel((state) => this.#channelChanged(state)),
    ]
    this.#cadence.start()
    transport.start()
  }

  stop(): void {
    this.#cadence.stop()
    this.#drain.stop()
    this.#options.transport.stop()

    for (const unlisten of this.#listening.splice(0)) {
      unlisten()
    }

    for (const { sync } of this.#regions.values()) {
      sync.channelDown()
    }

    this.#channel = 'down'
    this.#probing = 0
    this.#change.fire()
  }

  visibility(state: 'visible' | 'hidden'): void {
    this.#cadence.visibility(state)
  }

  localWrite(): void {
    this.#drain.request()
  }

  settled(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let waiting = true
      const cancel = this.#options.clock.schedule(timeoutMs, () => {
        waiting = false
        reject(new Error(`the sync did not settle within ${timeoutMs} ms`))
      })
      const watch = async (): Promise<void> => {
        while (waiting) {
          const change = this.#change.next()

          if (await this.#isSettled()) {
            if (waiting) {
              waiting = false
              cancel()
              resolve()
            }

            return
          }

          await change
        }
      }

      void watch()
    })
  }

  async signOut(): Promise<'signed-out' | 'offline'> {
    if (!(await this.#untilUp(SIGN_OUT_CHANNEL_MS))) {
      return 'offline'
    }

    this.#drain.request()

    try {
      await this.settled(SIGN_OUT_SETTLE_MS)
    } catch (cause) {
      // A channel that fell while draining leaves the device offline; a drain that stalls on
      // an open channel is the caller's to hear about.
      if (this.#channel !== 'up') {
        return 'offline'
      }

      throw cause
    }

    const ended = this.#untilEnded()

    if (!this.#options.transport.send({ type: 'sign-out', scope: 'device' })) {
      ended.cancel()

      return 'offline'
    }

    return ended.outcome
  }

  #receive(message: ServerMessage): void {
    match(message)
      .with({ type: 'welcome' }, () => {
        for (const { sync } of this.#regions.values()) {
          sync.subscribe()
        }
      })
      // The transport hands renewed keys to the app.
      .with({ type: 'tokens' }, () => {})
      .with({ type: 'heads' }, ({ regions }) => {
        this.#probing = Math.max(0, this.#probing - 1)

        for (const { region, head } of regions) {
          this.#regions.get(region)?.sync.catchUp(head)
        }

        this.#change.fire()
      })
      .with({ type: 'error' }, (error) => {
        this.#options.onError(
          dataError(
            'data:QUERY_FAILED',
            `the gateway answered with a ${error.code} error: ${error.message}`,
          ),
        )

        // An internal error may answer a push in flight; the regions settle it as failed for now.
        if (error.code === 'internal') {
          for (const { sync } of this.#regions.values()) {
            this.#track(sync.handle(error))
          }
        }
      })
      .with({ type: P.union('updates', 'ack', 'reject', 'compaction') }, (regional) => {
        const synced = this.#regions.get(regional.region)

        if (synced) {
          this.#track(synced.sync.handle(regional))
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

  #channelChanged(state: ChannelState): void {
    this.#channel = state

    if (state === 'down') {
      this.#probing = 0

      for (const { sync } of this.#regions.values()) {
        sync.channelDown()
      }
    }

    this.#cadence.channel(state)
    this.#options.onState({ channel: state })
    this.#change.fire()
  }

  async #pass(kind: PassKind): Promise<void> {
    this.#passing = true

    try {
      if (this.#options.transport.send({ type: 'probe', regions: [...this.#regions.keys()] })) {
        this.#probing += 1
      }

      if (kind === 'full') {
        for (const { sync } of this.#regions.values()) {
          sync.retryPull()
        }

        this.#drain.request()
        await this.#drain.idle()
      }
    } finally {
      this.#passing = false
      this.#change.fire()
    }
  }

  /** The next batch of the first region that has one. */
  async #pushNext(): Promise<'sent' | 'empty' | 'down'> {
    try {
      for (const { sync } of this.#regions.values()) {
        const outcome = await sync.pushNext()

        if (outcome !== 'empty') {
          return outcome
        }
      }

      return 'empty'
    } finally {
      this.#change.fire()
    }
  }

  #track(handled: Promise<void>): void {
    this.#handling += 1
    void handled.finally(() => {
      this.#handling -= 1
      this.#change.fire()
    })
  }

  async #isSettled(): Promise<boolean> {
    await this.#drain.idle()

    const syncing = [...this.#regions.values()].filter(({ sync }) => !sync.stopped())
    const outboxes = await Promise.all(
      syncing.map(({ region }) =>
        region
          .flush()
          // A failed append is the write path's to report; the outbox is what counts here.
          .orElse(() => okAsync(undefined))
          .andThen(() => region.outbox(1)),
      ),
    )

    return (
      this.#channel === 'up' &&
      !this.#passing &&
      this.#probing === 0 &&
      this.#handling === 0 &&
      outboxes.every((rows) => rows.isOk() && rows.value.length === 0) &&
      [...this.#regions.values()].every(({ sync }) => sync.quiet())
    )
  }

  /** Resolves true once the channel is up, or false after `ms` on the clock. */
  #untilUp(ms: number): Promise<boolean> {
    if (this.#channel === 'up') {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      const finish = (up: boolean) => {
        unlisten()
        cancel()
        resolve(up)
      }
      const unlisten = this.#options.transport.onChannel((state) => {
        if (state === 'up') {
          finish(true)
        }
      })
      const cancel = this.#options.clock.schedule(ms, () => finish(false))
    })
  }

  /**
   * Resolves `signed-out` once the transport reports the channel ended (the gateway closes it
   * after the sign-out; keys it refuses end the device all the same), or `offline` when the
   * channel falls without ending.
   */
  #untilEnded(): { readonly outcome: Promise<'signed-out' | 'offline'>; cancel(): void } {
    const transport = this.#options.transport
    let unlisten: Array<() => void> = []
    const cancel = () => {
      for (const stop of unlisten.splice(0)) {
        stop()
      }
    }
    const outcome = new Promise<'signed-out' | 'offline'>((resolve) => {
      const finish = (result: 'signed-out' | 'offline') => {
        cancel()
        resolve(result)
      }

      unlisten = [
        transport.onEnded(() => finish('signed-out')),
        transport.onChannel((state) => {
          if (state === 'down') {
            finish('offline')
          }
        }),
      ]
    })

    return { outcome, cancel }
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
