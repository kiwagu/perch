/**
 * Changes of a connection's regions told from outside its message queue: the identity's
 * memberships changed, or one region was revoked. They do not wait for the device's messages;
 * one told while the hello is under way applies right after the welcome, before any later
 * message is handled.
 */

import type { ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'

import type { ConnectionHost } from './connection-host'
import { answerFailed } from './connection-reasons'
import { regionsFor } from './device-regions'
import type { RegionSubscriptions } from './region-subscriptions'

export interface RegionChangesOptions {
  readonly host: ConnectionHost
  readonly subscriptions: RegionSubscriptions
  /** Who may write what in each region: the regions of the memberships are built from it. */
  readonly schema: ReplicaSchema
  /** Whether the hello is under way: a change then waits for the welcome. */
  readonly helloUnderWay: () => boolean
}

export class RegionChanges {
  readonly #host: ConnectionHost
  readonly #subscriptions: RegionSubscriptions
  readonly #schema: ReplicaSchema
  readonly #helloUnderWay: () => boolean
  /** The changes of memberships told while the hello is under way, applied after the welcome. */
  readonly #afterWelcome: Array<() => void> = []
  /** Resolves once the hello settled: the device was welcomed, or the socket closed. */
  readonly #helloSettled: Promise<void>
  #settleHello: () => void = () => {}

  constructor(options: RegionChangesOptions) {
    this.#host = options.host
    this.#subscriptions = options.subscriptions
    this.#schema = options.schema
    this.#helloUnderWay = options.helloUnderWay
    this.#helloSettled = new Promise((resolve) => {
      this.#settleHello = resolve
    })
  }

  /** The identity's memberships are now `next`; resolves once they were sent, or the socket closed. */
  memberships(next: readonly Membership[]): Promise<void> {
    return this.#change(() => this.#changeMemberships(next))
  }

  /** The identity left the organisation of `region`; resolves at once. */
  revoke(region: string): Promise<void> {
    void this.#change(() => this.#leave(region))

    return Promise.resolve()
  }

  /** The device was welcomed: the changes told while the hello was under way apply now. */
  welcomed(): void {
    for (const apply of this.#afterWelcome.splice(0)) {
      this.#guarded(apply)
    }

    this.#settleHello()
  }

  /** The socket closed: nothing waits for the welcome any more. */
  closed(): void {
    this.#afterWelcome.length = 0
    this.#settleHello()
  }

  /**
   * Applies a change of the device's regions now, outside the queue of messages; while the
   * hello is under way it waits for the welcome. Resolves once applied, or the socket closed.
   */
  #change(apply: () => void): Promise<void> {
    if (this.#helloUnderWay()) {
      this.#afterWelcome.push(apply)

      return this.#helloSettled
    }

    this.#guarded(apply)

    return Promise.resolve()
  }

  /** Runs `apply`; a send that throws fails the connection, as in the queue. */
  #guarded(apply: () => void): void {
    try {
      apply()
    } catch (cause) {
      this.#host.fail(answerFailed(cause))
    }
  }

  /** Leaves the regions the device may no longer name, replaces its regions and tells it. */
  #changeMemberships(next: readonly Membership[]): void {
    const device = this.#host.device()

    if (device === undefined) {
      return
    }

    const regions = regionsFor(device.identity.id, next, this.#schema)

    this.#subscriptions.keepOnly(regions)
    this.#host.ready({ ...device, regions })
    this.#host.send({ type: 'memberships', memberships: [...next] })
  }

  /** Takes `region` from the regions the device may name, and leaves it at the hub. */
  #leave(region: string): void {
    const device = this.#host.device()

    if (device === undefined) {
      return
    }

    const regions = new Map(device.regions)

    regions.delete(region)
    this.#host.ready({ ...device, regions })
    this.#subscriptions.leave(region)
  }
}
