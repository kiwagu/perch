/**
 * The regions a connection's device subscribed to at the hub, to leave when the device may no
 * longer name them, signs out or its socket closes.
 */

import type { Actor, RegionHub, Subscriber } from '@workspace/replica/server'

import type { DeviceRegion } from './device-regions'

export class RegionSubscriptions {
  readonly #hub: Pick<RegionHub, 'unsubscribe' | 'changeActor'>
  /** The connection as the hub knows it: the hub answers the device through it. */
  readonly subscriber: Subscriber
  /** The regions the device subscribed to, to leave when the socket closes. */
  readonly #subscribed = new Set<string>()

  constructor(hub: Pick<RegionHub, 'unsubscribe' | 'changeActor'>, subscriber: Subscriber) {
    this.#hub = hub
    this.subscriber = subscriber
  }

  /** The device subscribed to `region`. */
  add(region: string): void {
    this.#subscribed.add(region)
  }

  /** Leaves `region` at the hub, when the device subscribed to it. */
  leave(region: string): void {
    if (this.#subscribed.has(region)) {
      this.#unsubscribe(region)
    }
  }

  /** Leaves every region the device subscribed to that `regions` does not hold. */
  keepOnly(regions: ReadonlyMap<string, unknown>): void {
    for (const region of [...this.#subscribed]) {
      if (!regions.has(region)) {
        this.#unsubscribe(region)
      }
    }
  }

  /** The device pushes into `region` as `actor` from now on, when it subscribed to it. */
  changeActor(region: string, actor: Actor): void {
    if (this.#subscribed.has(region)) {
      this.#hub.changeActor(region, this.subscriber.id, actor)
    }
  }

  /** Each region the device subscribed to that `regions` holds pushes as the actor `regions` names. */
  changeActors(regions: ReadonlyMap<string, DeviceRegion>): void {
    for (const region of this.#subscribed) {
      const entry = regions.get(region)

      if (entry) {
        this.#hub.changeActor(region, this.subscriber.id, entry.actor)
      }
    }
  }

  /** Leaves every region the device subscribed to. */
  leaveAll(): void {
    for (const region of this.#subscribed) {
      this.#hub.unsubscribe(region, this.subscriber.id)
    }

    this.#subscribed.clear()
  }

  #unsubscribe(region: string): void {
    this.#hub.unsubscribe(region, this.subscriber.id)
    this.#subscribed.delete(region)
  }
}
