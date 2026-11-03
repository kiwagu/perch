import { match, P } from 'ts-pattern'

import type { Clock } from '../clock'

import type { EngineSettling } from './engine-settling'
import type { OutboxDrainPort } from './outbox-drain'
import type { SyncTransport } from './transport'

/** How long a sign-out waits for the channel to come up. */
const SIGN_OUT_CHANNEL_MS = 5_000

/** How long a sign-out waits for the outbox to drain. */
const SIGN_OUT_SETTLE_MS = 10_000

/** How long a sign-out waits for the gateway to close the channel. */
const SIGN_OUT_CLOSE_MS = 10_000

export interface EngineSignOutOptions {
  readonly transport: SyncTransport
  /** Times the sign-out's waits. */
  readonly clock: Clock
  readonly drain: OutboxDrainPort
  /** Tells when the outbox drained, and whether a region that stopped syncing holds what it has not sent. */
  readonly settling: EngineSettling
  /** The channel is up. */
  readonly up: () => boolean
}

/**
 * Signs the device out through the gateway: waits up to 5 seconds for the channel, drains for up
 * to 10 seconds, then asks the gateway and resolves `signed-out` only on the sign-out close; any
 * other outcome resolves `offline`, the transport stopped when the gateway was asked in vain. A
 * device the platform says has no network resolves `offline` at once while its channel is down:
 * the channel cannot come up meanwhile.
 */
export class EngineSignOut {
  readonly #transport: SyncTransport
  readonly #clock: Clock
  readonly #drain: OutboxDrainPort
  readonly #settling: EngineSettling
  readonly #up: () => boolean
  /** A sign-out the gateway did not carry out stopped the channel. */
  #channelStopped = false

  constructor(options: EngineSignOutOptions) {
    this.#transport = options.transport
    this.#clock = options.clock
    this.#drain = options.drain
    this.#settling = options.settling
    this.#up = options.up
  }

  /** Whether a sign-out stopped the channel: it asked the gateway, which then did not sign the device out. */
  channelStopped(): boolean {
    return this.#channelStopped
  }

  /** `online`: the platform says the device has a network as the sign-out is asked for. */
  async run(online: boolean): Promise<'signed-out' | 'offline'> {
    if (!this.#up() && !online) {
      return 'offline'
    }

    if (!(await this.#untilUp(SIGN_OUT_CHANNEL_MS))) {
      return 'offline'
    }

    this.#drain.request()

    // What did not drain in time stays on the device, as when it is offline.
    const drained = await this.#settling.settled(SIGN_OUT_SETTLE_MS).then(
      () => true,
      () => false,
    )

    if (!drained) {
      return 'offline'
    }

    // A region that stopped syncing counts as settled, yet what its outbox holds never reaches
    // the gateway: the device stays signed in, as when it is offline.
    if (await this.#settling.stoppedWithUnsent()) {
      return 'offline'
    }

    const ended = this.#untilEnded()

    if (!this.#transport.send({ type: 'sign-out', scope: 'device' })) {
      ended.cancel()

      return 'offline'
    }

    return ended.outcome
  }

  /** A sign-out asked for in vain: the channel stops, and no reconnect follows. */
  #stopChannel(): void {
    this.#channelStopped = true
    this.#transport.stop()
  }

  /** Resolves true once the channel is up, or false after `ms` on the clock. */
  #untilUp(ms: number): Promise<boolean> {
    if (this.#up()) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      const finish = (up: boolean) => {
        unlisten()
        cancel()
        resolve(up)
      }
      const unlisten = this.#transport.onChannel((state) => {
        if (state === 'up') {
          finish(true)
        }
      })
      const cancel = this.#clock.schedule(ms, () => finish(false))
    })
  }

  /**
   * Resolves `signed-out` once the transport reports the channel ended with the sign-out (the
   * gateway ended the session and closed it). Anything else signed nothing out for sure and
   * resolves `offline`, the transport stopped so that it does not connect again: a channel
   * that ends otherwise (a refused token or protocol, a sign-out from another device), falls
   * without ending (a gateway that failed to end the session closes so), or is not closed
   * within 10 seconds on the clock.
   */
  #untilEnded(): { readonly outcome: Promise<'signed-out' | 'offline'>; cancel(): void } {
    const transport = this.#transport
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
              .with(
                P.union('unauthorized', 'protocol', 'revoked', 'password-changed'),
                () => 'offline' as const,
              )
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
        // session may still be live, so the device leaves as when it is offline.
        this.#clock.schedule(SIGN_OUT_CLOSE_MS, () => {
          finish('offline')
          this.#stopChannel()
        }),
      ]
    })

    return { outcome, cancel }
  }
}
