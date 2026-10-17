import { okAsync } from 'neverthrow'
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
   * the outbox is empty, nothing waits for an answer (a push, a pull, a probe, a compaction),
   * no pass runs and no message is being handled; rejects after `timeoutMs` on the clock. A
   * region that stopped syncing counts as settled: its failure was reported.
   */
  settled(timeoutMs: number): Promise<void>
  /**
   * Waits up to 5 seconds for the channel, drains for up to 10 seconds, then asks the gateway to
   * sign this device out; resolves `signed-out` when the gateway ended the channel or, its close
   * not coming within 10 seconds, once the transport is stopped. Resolves `offline`, without
   * asking the gateway, when the channel stayed down, fell, the outbox did not drain in time, or a
   * region that stopped syncing still holds outbox rows. Never rejects.
   */
  signOut(): Promise<'signed-out' | 'offline'>
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
      // The transport hands renewed keys to the app.
      .with({ type: 'tokens' }, () => {})
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
      this.#probes.length === 0 &&
      this.#handling === 0 &&
      outboxes.every((rows) => rows.isOk() && rows.value.length === 0) &&
      [...this.#regions.values()].every(({ sync }) => sync.quiet())
    )
  }

  /** Whether a region that stopped syncing still holds outbox rows; an outbox it cannot read counts. */
  async #stoppedWithUnsent(): Promise<boolean> {
    const stopped = [...this.#regions.values()].filter(({ sync }) => sync.stopped())
    const unsent = await Promise.all(
      stopped.map(({ region }) =>
        region
          .flush()
          // A failed append is the write path's to report; the outbox is what counts here.
          .orElse(() => okAsync(undefined))
          .andThen(() => region.outbox(1))
          .match(
            (rows) => rows.length > 0,
            () => true,
          ),
      ),
    )

    return unsent.some(Boolean)
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
   * after the sign-out; keys it refuses end the device all the same), or once the close has not
   * come within 10 seconds on the clock, stopping the transport; `offline` when the channel
   * falls without ending or ends on a refused protocol, which signed nothing out.
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
              .with(P.union('signed-out', 'unauthorized'), () => 'signed-out' as const)
              .with('protocol', () => 'offline' as const)
              .exhaustive(),
          ),
        ),
        transport.onChannel((state) => {
          if (state === 'down') {
            finish('offline')
          }
        }),
        this.#options.clock.schedule(SIGN_OUT_CLOSE_MS, () => {
          finish('signed-out')
          transport.stop()
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
