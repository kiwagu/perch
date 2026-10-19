import type { Result, ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import { type DataError, type LocalDb, tenantRegionId } from '@workspace/data'
import { type Ability, defineAbilityFor, NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'

import type { Clock } from '../clock'
import {
  type ClientMessage,
  type CompactionOutcome,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  type ProtocolError,
  type ServerMessage,
  serverMessage,
} from '../protocol'
import type { RegionRef } from '../region-doc'
import { identityRegions } from '../region-ref'
import type { ReplicaSchema } from '../schema'
import { singleDatabase } from '../server/region-databases'
import { type Actor, RegionHub, type Subscriber } from '../server/region-hub'
import { type ChannelState, type EndReason, endingOf, type SyncTransport } from '../sync/transport'

export interface GatewayStubOptions {
  /** The gateway's database: the hub keeps the regions' logs there. */
  readonly local: LocalDb
  readonly schema: ReplicaSchema
  readonly clock: Clock
  /** How many log rows after the snapshot make an ack ask for a compaction. */
  readonly compactionLogLimit?: number
  /**
   * What every device is welcomed with; each opens its organisation's region, where the device's
   * batches are checked with the abilities of the membership's role. None by default.
   */
  readonly memberships?: readonly Membership[]
}

/** A device's channel to the stub, which the test can take offline and bring back. */
export interface StubTransport extends SyncTransport {
  /** The connection drops: the channel goes down and messages are lost both ways. */
  goOffline(): void
  /** The device connects again, as a reconnect would: a new welcome follows. */
  goOnline(): void
  /** Started, not offline and not signed out: the channel is meant to be up. */
  online(): boolean
  /** How many times the engine gave a connection up with `reconnect`. */
  reconnects(): number
}

export interface CompactionAnswer {
  readonly covers: number
  readonly outcome: CompactionOutcome
}

/** The device a channel of the stub names itself with when the test names none. */
export const STUB_DEVICE = 'test-device'

export interface GatewayStub {
  /** A channel of a device of `identity`, which names itself `device` (`test-device` by default). */
  transport(identity: string, device?: string): StubTransport
  readonly hub: RegionHub
  /** Loses the next batch of the others that the hub sends this device. */
  dropNextFanOutTo(transport: SyncTransport): void
  /** From now on every pushed batch is rejected as a table outside the region. */
  rejectEverything(): void
  /** The next pushed batch is never answered; resolves once it arrived. */
  swallowNextPush(): Promise<void>
  /** The next probe is never answered; resolves once it arrived. */
  swallowNextProbe(): Promise<void>
  /** The next pull is answered with the protocol error a device that is not subscribed gets. */
  refuseNextPull(): void
  /**
   * The next sign-out is taken in, as the gateway does while it revokes the grant (the device
   * leaves its regions, and nothing it sends after is handled), but the channel stays open;
   * resolves once it arrived.
   */
  keepOpenOnSignOut(): Promise<void>
  /**
   * The next sign-out is taken in, but the grant cannot be revoked: the gateway closes the
   * channel as a failed server (1011), which ends nothing; resolves once it arrived.
   */
  failNextSignOut(): Promise<void>
  /**
   * The next device to connect is handed these keys before its welcome, as the gateway does
   * when the access token a device presents no longer works and it renews the pair.
   */
  renewAtNextHello(tokens: { readonly access: string; readonly refresh: string }): void
  /** How many sign-outs the devices sent. */
  signOuts(): number
  /**
   * Ends the channel of every started device for good, as the gateway does when it refuses the
   * keys (`unauthorized`) or signs the device out: the device hears why, then the channel falls.
   */
  endWith(reason: EndReason): void
  /**
   * Closes the channels of `identity` with `code`, those of `device` only when it is given, as
   * the gateway closes the sockets of a device signed out from another one: a code that ends a
   * channel (such as 4001) ends it for good with its reason, any other drops the connection and
   * the device connects again.
   */
  closeChannels(identity: string, device: string | undefined, code: number): void
  /** How many rejects the devices were sent. */
  rejections(): number
  /** The outcomes of the compactions the devices proposed, in order. */
  compactions(): readonly CompactionAnswer[]
  /** What the hub reported through `onError`, and hub calls that failed. */
  failures(): readonly DataError[]
  /** Disconnects every device and closes the hub; the database stays open. */
  close(): Promise<void>
}

/** What every device channel of one stub shares. */
interface Gateway {
  readonly hub: RegionHub
  readonly schema: ReplicaSchema
  readonly clock: Clock
  readonly memberships: readonly Membership[]
  readonly failures: DataError[]
  readonly compactions: CompactionAnswer[]
  rejections: number
  signOuts: number
  rejectAll: boolean
  /** Set while the next push is to go unanswered: called when it arrives. */
  swallowPush: (() => void) | undefined
  /** Set while the next probe is to go unanswered: called when it arrives. */
  swallowProbe: (() => void) | undefined
  refusePull: boolean
  /** Set while the next sign-out is to leave the channel open: called when it arrives. */
  keepOpen: (() => void) | undefined
  /** Set while the next sign-out is to fail its revoke: called when it arrives. */
  failSignOut: (() => void) | undefined
  /** The keys the next device to connect is handed before its welcome. */
  renewal: { readonly access: string; readonly refresh: string } | undefined
}

/** A region the device may name, and who it subscribes there as. */
interface DeviceRegion {
  readonly ref: RegionRef
  readonly actor: Actor
}

/** One connection of a device: its end at the hub, up once welcomed. */
interface Connection {
  readonly subscriber: Subscriber
  up: boolean
  /** The device asked to be signed out on it: nothing it sends after is handled. */
  signedOut: boolean
  /** Subscriptions and pulls sent on it that wait for their updates. */
  asked: number
}

/** A message the protocol refuses here was built wrong by the engine or the hub. */
function crossed<T>(decoded: Result<T, ProtocolError>, type: string): T {
  if (decoded.isErr()) {
    throw new Error(`the protocol refuses a ${type} message: ${decoded.error.message}`)
  }

  return decoded.value
}

/** A device's message as the gateway reads it: encoded, then decoded. */
function sentByDevice(message: ClientMessage): ClientMessage {
  return crossed(decodeMessage(clientMessage, encodeMessage(clientMessage, message)), message.type)
}

/** A gateway's message as the device reads it: encoded, then decoded. */
function sentToDevice(message: ServerMessage): ServerMessage {
  return crossed(decodeMessage(serverMessage, encodeMessage(serverMessage, message)), message.type)
}

/**
 * A device's channel to the stub: like the gateway's sync connection, without a network. It
 * is welcomed with the identity's own region, where it may do anything as the owner, and the
 * region of each of the stub's memberships, where it may do what the membership's role allows;
 * it hands subscriptions, pulls, pushes and compactions in those regions to the hub, answers
 * probes with the hub's heads and delivers what the hub sends, each message through the
 * protocol's encoding both ways.
 */
class DeviceChannel implements StubTransport {
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
    const roles = new Map(
      gateway.memberships.map(({ tenant, role }) => [tenantRegionId(tenant.key), role]),
    )

    this.#regions = new Map(
      identityRegions(identity, gateway.memberships).map((ref) => {
        const role = roles.get(ref.id)
        // As the gateway does: only the private region is the identity's own.
        const ability: Ability =
          ref.kind === 'private'
            ? OWNER_ABILITY
            : role === undefined
              ? NO_ABILITY
              : defineAbilityFor({ id: identity, role }, gateway.schema)

        return [ref.id, { ref, actor: { id: identity, ability } }]
      }),
    )
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
    this.#settle(
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

    const renewed = this.#gateway.renewal

    if (renewed) {
      this.#gateway.renewal = undefined
      this.#deliver(connection, { type: 'tokens', ...renewed })
    }

    this.#deliver(connection, {
      type: 'welcome',
      identity: this.#identity,
      regions: [...regions],
      memberships: [...this.#gateway.memberships],
      time: this.#gateway.clock.now(),
    })

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

    const hub = this.#gateway.hub
    const subscriber = connection.subscriber
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

    match(message)
      .with({ type: 'hello' }, () => {})
      .with({ type: 'subscribe' }, ({ region, vv }) => {
        const named = this.#regions.get(region)

        // Checked above: the device may name the region.
        if (named) {
          connection.asked += 1
          this.#settle(hub.subscribe(named.ref, named.actor, subscriber, vv))
        }
      })
      .with({ type: 'pull' }, ({ region, vv }) => {
        connection.asked += 1

        if (this.#gateway.refusePull) {
          this.#gateway.refusePull = false
          this.#deliver(connection, {
            type: 'error',
            code: 'protocol',
            message: `not subscribed to region ${region}`,
          })
        } else {
          this.#settle(hub.pull(region, subscriber, vv))
        }
      })
      .with({ type: 'push' }, ({ region, batch, updates }) => {
        const swallowed = this.#gateway.swallowPush

        if (swallowed) {
          this.#gateway.swallowPush = undefined
          swallowed()
        } else if (this.#gateway.rejectAll) {
          this.#deliver(connection, {
            type: 'reject',
            region,
            batch,
            reason: 'foreign-table',
            detail: 'the test gateway rejects every batch',
          })
        } else {
          this.#settle(hub.push(region, subscriber, batch, updates))
        }
      })
      .with({ type: 'compact' }, ({ region, covers, snapshot }) => {
        this.#settle(hub.compact(region, subscriber, covers, snapshot))
      })
      .with({ type: 'probe' }, ({ regions }) => {
        const swallowed = this.#gateway.swallowProbe

        if (swallowed) {
          this.#gateway.swallowProbe = undefined
          swallowed()

          return
        }

        this.#settle(
          hub.heads(regions).andTee((heads) =>
            this.#deliver(connection, {
              type: 'heads',
              regions: [...heads],
              time: this.#gateway.clock.now(),
            }),
          ),
        )
      })
      .with({ type: 'sign-out' }, () => this.#signOut(connection))
      .exhaustive()
  }

  /** The gateway leaves the device's regions and closes the channel for good. */
  #signOut(connection: Connection): void {
    const keptOpen = this.#gateway.keepOpen
    const failed = this.#gateway.failSignOut

    this.#gateway.signOuts += 1

    if (keptOpen) {
      this.#gateway.keepOpen = undefined
      connection.signedOut = true
      this.#leave(connection)
      keptOpen()

      return
    }

    // A close that ends nothing: the connection is gone, the device may come back.
    if (failed) {
      this.#gateway.failSignOut = undefined
      failed()
      this.#disconnect()

      return
    }

    if (this.#connection === connection) {
      this.end('signed-out')
    }
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

  /** The hub answers the device itself; a call that fails all the same is recorded. */
  #settle(call: ResultAsync<unknown, DataError>): void {
    void call.match(
      () => {},
      (error) => {
        this.#gateway.failures.push(error)
      },
    )
  }
}

/**
 * A gateway without a network for tests of the sync engine: a region hub on the given database
 * and, per device, a transport that behaves like the gateway's connection.
 */
export function gatewayStub(options: GatewayStubOptions): GatewayStub {
  const failures: DataError[] = []
  const hub = new RegionHub({
    databases: singleDatabase(options.local),
    schema: options.schema,
    clock: options.clock,
    onError: (error) => failures.push(error),
    ...(options.compactionLogLimit === undefined
      ? {}
      : { compactionLogLimit: options.compactionLogLimit }),
  })
  const gateway: Gateway = {
    hub,
    schema: options.schema,
    clock: options.clock,
    memberships: options.memberships ?? [],
    failures,
    compactions: [],
    rejections: 0,
    signOuts: 0,
    rejectAll: false,
    swallowPush: undefined,
    swallowProbe: undefined,
    refusePull: false,
    keepOpen: undefined,
    failSignOut: undefined,
    renewal: undefined,
  }
  const channels: DeviceChannel[] = []

  return {
    hub,
    transport(identity, device = STUB_DEVICE) {
      const channel = new DeviceChannel(gateway, identity, device)

      channels.push(channel)

      return channel
    },
    dropNextFanOutTo(transport) {
      const channel = channels.find((candidate) => candidate === transport)

      if (!channel) {
        throw new Error('the transport does not belong to this gateway stub')
      }

      channel.dropNextFanOut()
    },
    rejectEverything() {
      gateway.rejectAll = true
    },
    swallowNextPush() {
      return new Promise((resolve) => {
        gateway.swallowPush = resolve
      })
    },
    swallowNextProbe() {
      return new Promise((resolve) => {
        gateway.swallowProbe = resolve
      })
    },
    refuseNextPull() {
      gateway.refusePull = true
    },
    keepOpenOnSignOut() {
      return new Promise((resolve) => {
        gateway.keepOpen = resolve
      })
    },
    failNextSignOut() {
      return new Promise((resolve) => {
        gateway.failSignOut = resolve
      })
    },
    renewAtNextHello(tokens) {
      gateway.renewal = tokens
    },
    signOuts: () => gateway.signOuts,
    endWith(reason) {
      for (const channel of channels) {
        channel.end(reason)
      }
    },
    closeChannels(identity, device, code) {
      for (const channel of channels) {
        if (channel.belongsTo(identity, device)) {
          channel.closeWith(code)
        }
      }
    },
    rejections: () => gateway.rejections,
    compactions: () => [...gateway.compactions],
    failures: () => [...gateway.failures],
    async close() {
      for (const channel of channels) {
        channel.stop()
      }

      await hub.close()
    },
  }
}
