import { LoroMap } from 'loro-crdt'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import { profileSchema } from '../../__fixtures__/profile'
import { RegionDoc } from '../../region-doc'
import { type GatewayStub, gatewayStub, type StubTransport } from '../../testing/gateway-stub'
import { type ManualClock, manualClock } from '../../testing/manual-clock'
import { createSyncEngine, type SyncEngine } from '../sync-engine'
import type { ChannelState } from '../transport'

export const identity = 'idn_a'

export const regionId = `identity:${identity}`

export const profileKey = 'profile/prf_1'

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
    schema: profileSchema,
    clock,
    ...(options.compactionLogLimit === undefined
      ? {}
      : { compactionLogLimit: options.compactionLogLimit }),
  })
  const gateway = { stub, clock, server }

  opened.push({ gateway, devices: [] })

  return gateway
}

/** A device with an empty database whose engine syncs the identity's region through the gateway; not started. */
export async function openDevice(gateway: Gateway): Promise<Device> {
  const local = (await openTestDb())._unsafeUnwrap()
  const region = (await RegionDoc.open(local, { kind: 'private', id: regionId }))._unsafeUnwrap()
  const transport = gateway.stub.transport(identity)
  const errors: DataError[] = []
  let channel: ChannelState = 'down'
  const engine = createSyncEngine({
    regions: [region],
    transport,
    clock: gateway.clock,
    actor: regionId,
    onState: (state) => {
      channel = state.channel
    },
    onSettled: () => {},
    onError: (error) => errors.push(error),
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
