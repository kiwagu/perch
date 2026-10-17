import { LoroMap } from 'loro-crdt'

import { type DataError, type LocalDb, tenantRegionId } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { tenantIdFactory } from '@workspace/ids'

import { replicaSchema } from '../../__fixtures__/note'
import { profileSchema } from '../../__fixtures__/profile'
import type { Membership } from '../../protocol'
import { RegionDoc, type RegionRef } from '../../region-doc'
import { privateRegionId } from '../../region-ref'
import type { ReplicaSchema } from '../../schema'
import { type GatewayStub, gatewayStub, type StubTransport } from '../../testing/gateway-stub'
import { type ManualClock, manualClock } from '../../testing/manual-clock'
import { createSyncEngine, type SyncEngine } from '../sync-engine'
import type { ChannelState } from '../transport'

export const identity = 'idn_a'

export const regionId = `identity:${identity}`

export const profileKey = 'profile/prf_1'

/** Two identities of the organisation Acme, each with a device in its region. */
export const ann = 'idn_ann'

export const bob = 'idn_bob'

/** Ann's and Bob's membership of Acme: both are members, neither an admin. */
export const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const acmeRegion: RegionRef = { kind: 'tenant', id: tenantRegionId(acme.tenant.key) }

/** How long a test waits for the devices to settle; the manual clock never gets there on its own. */
const SETTLE_MS = 60_000

/** One device of the identity: its own database and region document, synced through the stub. */
export interface Device {
  readonly local: LocalDb
  readonly region: RegionDoc
  readonly transport: StubTransport
  readonly engine: SyncEngine
  /** What the engine reported through `onError`. */
  readonly errors: DataError[]
  /** The channel state the engine reported last. */
  channel(): ChannelState
}

export interface Gateway {
  readonly stub: GatewayStub
  readonly clock: ManualClock
  readonly server: LocalDb
}

export interface GatewayOptions {
  readonly compactionLogLimit?: number
  /** Wraps the gateway's database, e.g. to make a query fail. */
  readonly wrap?: (server: LocalDb) => LocalDb
  /** The replicated tables, the profile alone by default. */
  readonly schema?: ReplicaSchema
  /** The organisations every device is welcomed with, none by default. */
  readonly memberships?: readonly Membership[]
}

export interface DeviceOptions {
  /** Wraps the device's database, e.g. to make a query fail. */
  readonly wrap?: (local: LocalDb) => LocalDb
  /** The identity the device belongs to, `idn_a` by default. */
  readonly identity?: string
  /** The region the device syncs, its identity's private region by default. */
  readonly region?: RegionRef
  /** How many outbox rows one push carries at most, the protocol's limit by default. */
  readonly batchRows?: number
}

const opened: Array<{ readonly gateway: Gateway; readonly devices: Device[] }> = []

/** Names the profile, creating it for the identity when the region does not hold it yet. */
export function writeName(region: RegionDoc, name: string): void {
  if (region.recordJson(profileKey) === undefined) {
    const record = region.records().setContainer(profileKey, new LoroMap())

    record.set('identity', regionId)
    record.set('email', 'ann@example.test')
  }

  region.recordMap(profileKey).set('name', name)
  region.doc.commit()
}

export function writeBio(region: RegionDoc, bio: string): void {
  region.recordMap(profileKey).ensureMergeableText('bio').update(bio)
  region.doc.commit()
}

/** A gateway stub on a fresh embedded database, with a manual clock. */
export async function openGateway(options: GatewayOptions = {}): Promise<Gateway> {
  const clock = manualClock()
  const server = (await openTestDb())._unsafeUnwrap()
  const stub = gatewayStub({
    local: options.wrap ? options.wrap(server) : server,
    schema: options.schema ?? profileSchema,
    clock,
    memberships: options.memberships ?? [],
    ...(options.compactionLogLimit === undefined
      ? {}
      : { compactionLogLimit: options.compactionLogLimit }),
  })
  const gateway = { stub, clock, server }

  opened.push({ gateway, devices: [] })

  return gateway
}

/** A device with an empty database whose engine syncs one region through the gateway; not started. */
export async function openDevice(gateway: Gateway, options: DeviceOptions = {}): Promise<Device> {
  const owner = options.identity ?? identity
  const local = (await openTestDb())._unsafeUnwrap()
  const region = (
    await RegionDoc.open(
      options.wrap ? options.wrap(local) : local,
      options.region ?? { kind: 'private', id: privateRegionId(owner) },
    )
  )._unsafeUnwrap()
  const transport = gateway.stub.transport(owner)
  const errors: DataError[] = []
  let channel: ChannelState = 'down'
  const engine = createSyncEngine({
    regions: [region],
    transport,
    clock: gateway.clock,
    actor: privateRegionId(owner),
    onState: (state) => {
      channel = state.channel
    },
    onSettled: () => {},
    onError: (error) => errors.push(error),
    ...(options.batchRows === undefined ? {} : { batchRows: options.batchRows }),
  })
  const device: Device = { local, region, transport, engine, errors, channel: () => channel }

  opened.find((entry) => entry.gateway === gateway)?.devices.push(device)

  return device
}

/**
 * Waits until every device that is meant to be online has settled. A device settles once its
 * own batches are acknowledged, and the gateway sends those batches to the other devices in
 * the same breath, so a second round waits for the other devices to take them in.
 */
export async function settleAll(devices: readonly Device[]): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await Promise.all(
      devices
        .filter((device) => device.transport.online())
        .map((device) => device.engine.settled(SETTLE_MS)),
    )
  }
}

/** Two started devices of one identity whose region holds the identity's profile, named Ann. */
export async function twoDevices(options: GatewayOptions = {}) {
  const gateway = await openGateway(options)
  const a = await openDevice(gateway)
  const b = await openDevice(gateway)
  const settle = () => settleAll([a, b])

  a.engine.start()
  b.engine.start()
  writeName(a.region, 'Ann')
  a.engine.localWrite()
  await settle()

  return {
    ...gateway,
    a,
    b,
    settle,
    errors: (): DataError[] => [...a.errors, ...b.errors],
  }
}

/**
 * A started device of Ann and one of Bob, both members of Acme, syncing the organisation's
 * region; each push carries at most `batchRows` rows, the protocol's limit by default.
 */
export async function twoMembers(options: Pick<DeviceOptions, 'batchRows'> = {}) {
  const gateway = await openGateway({ schema: replicaSchema, memberships: [acme] })
  const a = await openDevice(gateway, { ...options, identity: ann, region: acmeRegion })
  const b = await openDevice(gateway, { ...options, identity: bob, region: acmeRegion })
  const settle = () => settleAll([a, b])

  a.engine.start()
  b.engine.start()
  await settle()

  return {
    ...gateway,
    a,
    b,
    settle,
    errors: (): DataError[] => [...a.errors, ...b.errors],
  }
}

/** Stops every device and gateway opened since the last call; resolves to what the gateways reported. */
export async function closeDevices(): Promise<DataError[]> {
  const failures: DataError[] = []

  for (const { gateway, devices } of opened.splice(0)) {
    for (const device of devices) {
      device.engine.stop()
      await device.region.flush()
      device.region.close()
    }

    failures.push(...gateway.stub.failures())
    await gateway.stub.close()

    for (const device of devices) {
      await device.local.close()
    }

    await gateway.server.close()
  }

  return failures
}
