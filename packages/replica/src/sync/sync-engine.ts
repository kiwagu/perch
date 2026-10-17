import { match, P } from 'ts-pattern'

import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { ServerMessage } from '../protocol'
import type { RegionDoc } from '../region-doc'

import { type CadencePort, createCadence, type PassKind } from './cadence'
import { createOutboxDrain, type OutboxDrainPort } from './outbox-drain'
import { ANSWER_TIMEOUT_MS, RegionSync } from './region-sync'
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
  /** Connects again at once: the gateway welcomes the device anew and hands it fresh keys. */
  reconnect(): void
}

/** How long a sign-out waits for the channel to come up. */
const SIGN_OUT_CHANNEL_MS = 5_000

/** How long a sign-out waits for the outbox to drain. */
const SIGN_OUT_SETTLE_MS = 10_000

/** How long a sign-out waits for the gateway to close the channel. */
const SIGN_OUT_CLOSE_MS = 10_000

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
  /**
   * Probes sent on this connection whose heads have not arrived, oldest first, each as the
   * cancel of its answer timeout. Heads name no probe, so each answer settles the oldest.
   */
  #probes: Array<() => void> = []
  #passing = false
  /** A sign-out the gateway did not carry out stopped the channel. */
  #channelStopped = false
  /** Regions whose last flush failed, reported once until a flush succeeds again. */
  readonly #failingFlush = new Set<string>()

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
            clock: options.clock,
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
      transport.onEnded((reason) => this.#ended(reason)),
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
    this.#forgetProbes()
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

  channelStopped(): boolean {
    return this.#channelStopped
  }

  reconnect(): void {
    this.#options.transport.reconnect()
  }

  async signOut(): Promise<'signed-out' | 'offline'> {
    if (!(await this.#untilUp(SIGN_OUT_CHANNEL_MS))) {
      return 'offline'
    }

    this.#drain.request()

    // What did not drain in time stays on the device, as when it is offline.
    const drained = await this.settled(SIGN_OUT_SETTLE_MS).then(
      () => true,
      () => false,
    )

    if (!drained) {
      return 'offline'
    }

    // A region that stopped syncing counts as settled, yet what its outbox holds never reaches
    // the gateway: the device stays signed in, as when it is offline.
    if (await this.#stoppedWithUnsent()) {
      return 'offline'
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
      // The transport hands renewed keys and memberships to the app.
      .with({ type: P.union('tokens', 'memberships') }, () => {})
      .with({ type: 'heads' }, ({ regions }) => {
        this.#probes.shift()?.()

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

        // An error names no request: each region gives up what waits for an answer.
        for (const { sync } of this.#regions.values()) {
          this.#track(sync.handle(error))
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

  /**
   * The channel ended for good. A refused protocol stops syncing and is reported: this
   * application is older than the gateway, and only a reload brings one that speaks its
   * protocol; nothing on the device changes. Refused keys and a sign-out are the app's to act on.
   */
  #ended(reason: EndReason): void {
    match(reason)
      .with('protocol', () => {
        this.#cadence.stop()
        this.#drain.stop()
        this.#options.onError(
          dataError(
            'data:SYNC_STOPPED',
            'the gateway refused the protocol; reload the application',
          ),
        )
      })
      .with(P.union('unauthorized', 'signed-out'), () => {})
      .exhaustive()
  }

  #channelChanged(state: ChannelState): void {
    this.#channel = state

    if (state === 'down') {
      this.#forgetProbes()

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
        this.#awaitHeads()
      }

      if (kind === 'full') {
        for (const { sync } of this.#regions.values()) {
          sync.resubscribe()
          sync.retryPull()
        }

        // What other tabs wrote reaches this document even while the channel is down.
        await Promise.all([...this.#regions.values()].map(({ sync }) => sync.catchUpLocal()))
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

  /**
   * Waits for the heads of a probe just sent; when none come within 30 seconds the probe is
   * given up, reported, and the connection, which stopped answering, is made again.
   */
  #awaitHeads(): void {
    const cancel = this.#options.clock.schedule(ANSWER_TIMEOUT_MS, () => {
      this.#probes = this.#probes.filter((pending) => pending !== cancel)
      this.#options.onError(
        dataError(
          'data:QUERY_FAILED',
          `the gateway did not answer a probe within ${ANSWER_TIMEOUT_MS} ms`,
        ),
      )
      this.#options.transport.reconnect()
      this.#change.fire()
    })

    this.#probes.push(cancel)
  }

  /** The probes out will not be answered on this connection. */
  #forgetProbes(): void {
    for (const cancel of this.#probes.splice(0)) {
      cancel()
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
    const unsent = await Promise.all(syncing.map(({ region }) => this.#holdsUnsent(region)))

    return (
      this.#channel === 'up' &&
      !this.#passing &&
      this.#probes.length === 0 &&
      this.#handling === 0 &&
      !unsent.some(Boolean) &&
      [...this.#regions.values()].every(({ sync }) => sync.quiet())
    )
  }

  /** Whether a region that stopped syncing still holds what it has not sent. */
  async #stoppedWithUnsent(): Promise<boolean> {
    const stopped = [...this.#regions.values()].filter(({ sync }) => sync.stopped())
    const unsent = await Promise.all(stopped.map(({ region }) => this.#holdsUnsent(region)))

    return unsent.some(Boolean)
  }

  /**
   * Whether the region holds local updates the gateway has not acknowledged: outbox rows, or
   * an update whose append failed and so lives in memory only, which the outbox does not show
   * (reported once, until a flush succeeds again). An outbox that cannot be read counts.
   */
  #holdsUnsent(region: RegionDoc): Promise<boolean> {
    const id = region.ref.id

    return region
      .flush()
      .andTee(() => this.#failingFlush.delete(id))
      .orTee((error) => {
        if (!this.#failingFlush.has(id)) {
          this.#failingFlush.add(id)
          this.#options.onError(error)
        }
      })
      .andThen(() => region.outbox(1))
      .match(
        (rows) => rows.length > 0,
        () => true,
      )
  }

  /** A sign-out asked for in vain: the channel stops, and no reconnect follows. */
  #stopChannel(): void {
    this.#channelStopped = true
    this.#options.transport.stop()
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
   * Resolves `signed-out` once the transport reports the channel ended with the sign-out (the
   * gateway revoked the grant and closed it). Anything else signed nothing out for sure and
   * resolves `offline`, the transport stopped so that it does not connect again: a channel
   * that ends otherwise (refused keys or protocol), falls without ending (a gateway that failed
   * to revoke the grant closes so), or is not closed within 10 seconds on the clock.
   */
  #untilEnded(): { readonly outcome: Promise<'signed-out' | 'offline'>; cancel(): void } {
    const transport = this.#options.transport
    let release: Array<() => void> = []
    const cancel = () => {
      for (const stop of release.splice(0)) {
        stop()
      }
    }
    const outcome = new Promise<'signed-out' | 'offline'>((resolve) => {
      const finish = (result: 'signed-out' | 'offline') => {
        cancel()
        resolve(result)
      }

      release = [
        transport.onEnded((reason) =>
          finish(
            match(reason)
              .with('signed-out', () => 'signed-out' as const)
              .with(P.union('unauthorized', 'protocol'), () => 'offline' as const)
              .exhaustive(),
          ),
        ),
        transport.onChannel((state) => {
          if (state === 'down') {
            this.#stopChannel()
            finish('offline')
          }
        }),
        // A gateway that never closes the channel may never have taken the sign-out in: the
        // grant may stand, so the device leaves as when it is offline.
        this.#options.clock.schedule(SIGN_OUT_CLOSE_MS, () => {
          finish('offline')
          this.#stopChannel()
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
