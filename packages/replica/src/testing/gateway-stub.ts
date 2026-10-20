import type { DataError, LocalDb } from '@workspace/data'

import type { Clock } from '../clock'
import type { Membership } from '../protocol'
import type { ReplicaSchema } from '../schema'
import { singleDatabase } from '../server/region-databases'
import { RegionHub } from '../server/region-hub'
import type { EndReason, SyncTransport } from '../sync/transport'

import { DeviceChannel } from './device-channel'
import type { CompactionAnswer, Gateway, StubTransport } from './stub-state'

export type { CompactionAnswer, StubTransport }

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
   * The next renewal hands over these keys: before the welcome of the next device to connect,
   * as the gateway does when the access token a device presents no longer works, or as the
   * answer to the next renewal a device asks for over its channel.
   */
  renewAtNextHello(tokens: { readonly access: string; readonly refresh: string }): void
  /** Every renewal a device asks for over its channel is refused from now on, as by the limits. */
  refuseRenewals(): void
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
    refuseRenewals: false,
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
    refuseRenewals() {
      gateway.refuseRenewals = true
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
