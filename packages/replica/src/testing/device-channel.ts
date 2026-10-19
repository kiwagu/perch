import { match } from 'ts-pattern'

import type { ClientMessage, ServerMessage } from '../protocol'
import { type ChannelState, type EndReason, endingOf } from '../sync/transport'

import { compact, probe, pull, push, subscribe } from './stub-hub-requests'
import { signOut, welcome } from './stub-session'
import {
  type Connection,
  type DeviceRegion,
  deviceRegions,
  type Gateway,
  type StubTransport,
  sentByDevice,
  sentToDevice,
  settle,
} from './stub-state'

/**
 * A device's channel to the stub: like the gateway's sync connection, without a network. It
 * is welcomed with the identity's own region, where it may do anything as the owner, and the
 * region of each of the stub's memberships, where it may do what the membership's role allows;
 * it hands subscriptions, pulls, pushes and compactions in those regions to the hub, answers
 * probes with the hub's heads and delivers what the hub sends, each message through the
 * protocol's encoding both ways.
 */
export class DeviceChannel implements StubTransport {
  readonly #gateway: Gateway
  readonly #identity: string
  readonly #device: string
  /** The regions the device may name, by id. */
  readonly #regions: ReadonlyMap<string, DeviceRegion>
  readonly #messageListeners = new Set<(message: ServerMessage) => void>()
  readonly #channelListeners = new Set<(state: ChannelState) => void>()
  readonly #endedListeners = new Set<(reason: EndReason) => void>()
  #started = false
  #offline = false
  #ended = false
  #connection: Connection | undefined
  #dropNextFanOut = false
  #reconnects = 0

  constructor(gateway: Gateway, identity: string, device: string) {
    this.#gateway = gateway
    this.#identity = identity
    this.#device = device
    this.#regions = deviceRegions(gateway, identity)
  }

  start(): void {
    this.#started = true
    this.#connect()
  }

  stop(): void {
    this.#started = false
    this.#disconnect()
  }

  goOffline(): void {
    this.#offline = true
    this.#disconnect()
  }

  goOnline(): void {
    this.#offline = false
    this.#connect()
  }

  online(): boolean {
    return this.#started && !this.#offline && !this.#ended
  }

  /** The connection is given up and made again at once: the device is welcomed anew. */
  reconnect(): void {
    if (!this.#connection) {
      return
    }

    this.#reconnects += 1
    this.#disconnect()
    this.#connect()
  }

  reconnects(): number {
    return this.#reconnects
  }

  dropNextFanOut(): void {
    this.#dropNextFanOut = true
  }

  /** Whether this is a channel of `identity`, and of `device` when one is named. */
  belongsTo(identity: string, device: string | undefined): boolean {
    return this.#identity === identity && (device === undefined || this.#device === device)
  }

  /** The gateway closes the connection: for good with a code that ends it, else the device comes back. */
  closeWith(code: number): void {
    const ending = endingOf(code)

    if (ending) {
      this.end(ending)

      return
    }

    this.#disconnect()
    this.#connect()
  }

  /** The gateway ends the channel for good; a device that is not started has no channel. */
  end(reason: EndReason): void {
    if (!this.#started || this.#ended) {
      return
    }

    this.#ended = true

    for (const listener of this.#endedListeners) {
      listener(reason)
    }

    this.#disconnect()
  }

  send(message: ClientMessage): boolean {
    const connection = this.#connection

    if (!connection?.up) {
      return false
    }

    this.#serve(connection, sentByDevice(message))

    return true
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.#messageListeners.add(listener)

    return () => this.#messageListeners.delete(listener)
  }

  onChannel(listener: (state: ChannelState) => void): () => void {
    this.#channelListeners.add(listener)

    return () => this.#channelListeners.delete(listener)
  }

  onEnded(listener: (reason: EndReason) => void): () => void {
    this.#endedListeners.add(listener)

    return () => this.#endedListeners.delete(listener)
  }

  #connect(): void {
    if (!this.online() || this.#connection) {
      return
    }

    const connection: Connection = {
      subscriber: {
        id: crypto.randomUUID(),
        send: (message) => this.#deliver(connection, message),
      },
      up: false,
      asked: 0,
      signedOut: false,
    }

    this.#connection = connection
    settle(
      this.#gateway,
      this.#gateway.hub
        .heads([...this.#regions.keys()])
        .andTee((regions) => this.#welcome(connection, regions)),
    )
  }

  /** The gateway took the device's keys: the channel is up once the device is welcomed. */
  #welcome(
    connection: Connection,
    regions: ReadonlyArray<{ readonly region: string; readonly head: number }>,
  ): void {
    if (this.#connection !== connection) {
      return
    }

    connection.up = true
    welcome(this.#gateway, connection, this.#identity, regions)

    for (const listener of this.#channelListeners) {
      listener('up')
    }
  }

  /** The connection is gone: the hub forgets the device and nothing more crosses it. */
  #disconnect(): void {
    const connection = this.#connection

    if (!connection) {
      return
    }

    this.#connection = undefined
    this.#leave(connection)

    if (connection.up) {
      for (const listener of this.#channelListeners) {
        listener('down')
      }
    }
  }

  #serve(connection: Connection, message: ClientMessage): void {
    if (connection.signedOut) {
      return
    }

    const named =
      'region' in message ? [message.region] : message.type === 'probe' ? message.regions : []

    if (named.some((region) => !this.#regions.has(region))) {
      this.#deliver(connection, {
        type: 'error',
        code: 'forbidden-region',
        message: 'the region is not open to this device',
      })

      return
    }

    const gateway = this.#gateway

    match(message)
      .with({ type: 'hello' }, () => {})
      .with({ type: 'subscribe' }, (request) =>
        subscribe(gateway, connection, this.#regions.get(request.region), request),
      )
      .with({ type: 'pull' }, (request) => pull(gateway, connection, request))
      .with({ type: 'push' }, (request) => push(gateway, connection, request))
      .with({ type: 'compact' }, (request) => compact(gateway, connection, request))
      .with({ type: 'probe' }, (request) => probe(gateway, connection, request))
      .with({ type: 'sign-out' }, () =>
        signOut(gateway, connection, {
          leave: () => this.#leave(connection),
          drop: () => this.#disconnect(),
          end: () => {
            if (this.#connection === connection) {
              this.end('signed-out')
            }
          },
        }),
      )
      .exhaustive()
  }

  /** The hub forgets the connection in every region the device may name. */
  #leave(connection: Connection): void {
    for (const region of this.#regions.keys()) {
      this.#gateway.hub.unsubscribe(region, connection.subscriber.id)
    }
  }

  /** Hands a message the hub or the stub sends to the device, unless its connection is gone. */
  #deliver(connection: Connection, message: ServerMessage): void {
    const received = sentToDevice(message)

    if (received.type === 'reject') {
      this.#gateway.rejections += 1
    }

    if (received.type === 'compaction') {
      this.#gateway.compactions.push({ covers: received.covers, outcome: received.outcome })
    }

    if (this.#connection !== connection) {
      return
    }

    if (received.type === 'updates' || received.type === 'error') {
      if (connection.asked > 0) {
        connection.asked -= 1
      } else if (received.type === 'updates' && this.#dropNextFanOut) {
        this.#dropNextFanOut = false

        return
      }
    }

    for (const listener of this.#messageListeners) {
      listener(received)
    }
  }
}
