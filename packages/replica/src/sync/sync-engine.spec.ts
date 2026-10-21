import { afterEach, describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'

import { replicaSchema } from '../__fixtures__/note'
import countsStatement from '../__fixtures__/replica-counts.surql'
import { CLOSE } from '../protocol'
import { RegionDoc } from '../region-doc'
import acceptStatement from '../server/surql/server-accept.surql'
import loadStatement from '../server/surql/server-load.surql'
import appendStatement from '../surql/replica-append.surql'
import { interceptRegionResets } from '../testing/intercept-region-resets'
import type { ManualClock } from '../testing/manual-clock'

import {
  acmeRegion,
  ann,
  closeDevices,
  type Device,
  identity,
  openDevice,
  openGateway,
  profileKey,
  regionId,
  settleAll,
  twoDevices,
  writeName,
} from './__fixtures__/devices'

afterEach(async () => {
  await closeDevices()
})

/** Whether a promise has settled by the time the callbacks queued so far have run. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false

  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  return settled
}

/** How many snapshots and update-log rows the device's database holds of the region. */
async function localCounts(device: Device): Promise<{ snapshots: number; updates: number }> {
  const [snapshots, updates] = (await device.local.db.query(countsStatement, {
    region: regionId,
  })) as number[][]

  return { snapshots: snapshots?.[0] ?? 0, updates: updates?.[0] ?? 0 }
}

/** Moves the clock on a second at a time until the promise settles, for waits nothing else ends. */
async function driven<T>(clock: ManualClock, promise: Promise<T>): Promise<T> {
  let done = false

  void promise.finally(() => {
    done = true
  })

  while (!done) {
    await clock.advance(1_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return promise
}

describe('sync engine', () => {
  it('settles only once the subscription of the current connection is answered', async () => {
    const { a, b, settle } = await twoDevices()

    b.transport.goOffline()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    b.transport.goOnline()
    await b.engine.settled(60_000)

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
  })

  it('catches up through a probe when a batch never reached the device', async () => {
    const { a, b, stub, settle } = await twoDevices()

    stub.dropNextFanOutTo(b.transport)
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })

    // The tab comes back into view: a full pass probes the heads and pulls what is missing,
    // and the device settles only once the probe is answered and the pull imported.
    b.engine.visibility('hidden')
    b.engine.visibility('visible')
    await b.engine.settled(60_000)

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
    expect(b.region.pulled()).toBe(a.region.pulled())
  })

  it('rejects settled() once its time is up on the clock while the channel is down', async () => {
    const { b, clock } = await twoDevices()

    b.transport.goOffline()
    const settled = b.engine.settled(1_000)

    await clock.advance(999)

    expect(await hasSettled(settled)).toBe(false)

    await clock.advance(1)

    await expect(settled).rejects.toThrow('1000 ms')
  })

  it('delivers what is left, then signs the device out through the gateway', async () => {
    const { a, b, settle, stub } = await twoDevices()

    writeName(a.region, 'Ana')

    expect(await a.engine.signOut()).toBe('signed-out')
    expect(stub.signOuts()).toBe(1)
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(a.channel()).toBe('down')
    expect(a.transport.online()).toBe(false)

    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
  })

  it('hears that the gateway refused the keys, then the channel falls for good', async () => {
    const { a, stub } = await twoDevices()
    const heard: string[] = []

    a.transport.onEnded((reason) => heard.push(`${reason} while ${a.channel()}`))
    stub.endWith('unauthorized')

    expect(heard).toEqual(['unauthorized while up'])
    expect(a.channel()).toBe('down')
    expect(a.transport.online()).toBe(false)
  })

  it('hears that the device was signed out from another one, then the channel falls for good', async () => {
    const { a, stub } = await twoDevices()
    const heard: string[] = []

    a.transport.onEnded((reason) => heard.push(`${reason} while ${a.channel()}`))
    stub.endWith('revoked')
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    expect((await a.region.flush()).isOk()).toBe(true)

    expect(heard).toEqual(['revoked while up'])
    expect(a.channel()).toBe('down')
    expect(a.transport.online()).toBe(false)
    expect(a.errors).toEqual([])
    // What the device wrote stays in its outbox: the app decides what becomes of it.
    expect((await a.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('ends only the named device of the identity when the gateway closes it as revoked', async () => {
    const gateway = await openGateway()
    const a = await openDevice(gateway, { device: 'device-a' })
    const b = await openDevice(gateway, { device: 'device-b' })
    const heard: string[] = []

    a.transport.onEnded((reason) => heard.push(`a: ${reason}`))
    b.transport.onEnded((reason) => heard.push(`b: ${reason}`))
    a.engine.start()
    b.engine.start()
    await settleAll([a, b])

    gateway.stub.closeChannels(identity, 'device-a', CLOSE.revoked)

    expect(heard).toEqual(['a: revoked'])
    expect(a.channel()).toBe('down')
    expect(b.channel()).toBe('up')

    gateway.stub.closeChannels(identity, undefined, CLOSE.revoked)

    expect(heard).toEqual(['a: revoked', 'b: revoked'])
    expect(b.channel()).toBe('down')
  })

  it('stops syncing when the gateway refuses the protocol, and says to reload the application', async () => {
    const { a, stub } = await twoDevices()

    a.transport.goOffline()
    writeName(a.region, 'Ana')
    stub.endWith('protocol')
    a.engine.localWrite()

    expect(a.errors).toEqual([
      expect.objectContaining({
        code: 'data:SYNC_STOPPED',
        message: 'the gateway refused the protocol; reload the application',
      }),
    ])
    expect(a.channel()).toBe('down')
    // The rows stay in the outbox: nothing about the device's data changes.
    expect((await a.region.flush()).isOk()).toBe(true)
    expect((await a.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('keeps the device signed in when a region stops syncing with rows left in its outbox', async () => {
    // A region whose reset fails stops with the rows the gateway refused.
    const { a, stub } = await twoDevices(
      {},
      {
        wrap: (local) =>
          interceptRegionResets(local, () => {
            throw new Error('the database refuses the reset')
          }),
      },
    )

    stub.rejectEverything()
    a.transport.goOffline()
    writeName(a.region, 'Ana')

    const outcome = a.engine.signOut()

    // The channel comes back during the sign-out; the drain's batch is rejected, rolled back
    // and rejected again, and the region, which cannot reload, stops with the rows and their
    // inverse unsent.
    a.transport.goOnline()

    expect(await outcome).toBe('offline')
    expect(stub.signOuts()).toBe(0)
    expect(a.transport.online()).toBe(true)
    expect(a.errors.map((error) => error.code)).toContain('data:SYNC_STOPPED')
    expect((await a.region.outbox(10))._unsafeUnwrap().length).toBeGreaterThan(0)
  })

  it('signs out at the gateway once a reload dropped what the gateway refused', async () => {
    const { a, stub } = await twoDevices()

    stub.rejectEverything()
    a.transport.goOffline()
    writeName(a.region, 'Ana')

    const outcome = a.engine.signOut()

    // The batch is rejected, rolled back and rejected again: the region reloads from the server
    // without what the gateway refused, and nothing is left to send.
    a.transport.goOnline()

    expect(await outcome).toBe('signed-out')
    expect(stub.signOuts()).toBe(1)
    expect(a.errors.map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
  })

  it('reports offline when the channel stays down for 5 seconds', async () => {
    const { a, clock } = await twoDevices()

    a.transport.goOffline()
    const outcome = a.engine.signOut()

    await clock.advance(4_999)

    expect(await hasSettled(outcome)).toBe(false)

    await clock.advance(1)

    expect(await outcome).toBe('offline')
    // Nothing was asked of the gateway: the channel keeps trying.
    expect(a.engine.channelStopped()).toBe(false)
  })

  it('signs out once the channel comes back within 5 seconds', async () => {
    const { a, clock } = await twoDevices()

    a.transport.goOffline()
    const outcome = a.engine.signOut()

    await clock.advance(1_000)
    a.transport.goOnline()

    expect(await outcome).toBe('signed-out')
  })

  it('resolves offline, connecting no more, when the gateway closes as failed after the sign-out', async () => {
    const { a, stub } = await twoDevices()
    const received = stub.failNextSignOut()
    const outcome = a.engine.signOut()

    await received

    expect(await outcome).toBe('offline')
    expect(stub.signOuts()).toBe(1)
    expect(a.channel()).toBe('down')
    // Stopped: no reconnect brings the device back on keys the gateway could not revoke.
    expect(a.transport.online()).toBe(false)
    expect(a.engine.channelStopped()).toBe(true)
  })

  it('resolves offline when the channel ends for any reason but a sign-out after it was asked for', async () => {
    const { a, stub } = await twoDevices()
    const received = stub.keepOpenOnSignOut()
    const outcome = a.engine.signOut()

    await received
    stub.endWith('unauthorized')

    expect(await outcome).toBe('offline')
  })

  it('resolves offline 10 seconds after the sign-out when the gateway never closes the channel', async () => {
    const { a, stub, clock } = await twoDevices()
    const received = stub.keepOpenOnSignOut()
    const outcome = a.engine.signOut()

    await received
    await clock.advance(9_999)

    expect(await hasSettled(outcome)).toBe(false)

    await clock.advance(1)

    // A timer is no proof that the gateway revoked the grant.
    expect(await outcome).toBe('offline')
    expect(a.channel()).toBe('down')
    expect(a.transport.online()).toBe(false)
    expect(a.engine.channelStopped()).toBe(true)
  })

  it('does not settle while a local update fails to persist, reports it once and signs out offline', async () => {
    let failAppend = false
    const gateway = await openGateway()
    const a = await openDevice(gateway, {
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (failAppend && text === appendStatement) {
            throw new Error('the disk is full')
          }
        }),
    })

    a.engine.start()
    await settleAll([a])

    // The update stays in memory only: the outbox the engine reads is empty.
    failAppend = true
    writeName(a.region, 'Ann')
    a.engine.localWrite()

    const settling = a.engine.settled(1_000)

    // The engine looked at the region and found the update it could not persist: it says so, once.
    await vi.waitFor(() => expect(a.errors).toHaveLength(1))

    expect(await hasSettled(settling)).toBe(false)

    await gateway.clock.advance(1_000)

    await expect(settling).rejects.toThrow('1000 ms')
    expect(await driven(gateway.clock, a.engine.signOut())).toBe('offline')
    expect(gateway.stub.signOuts()).toBe(0)
    expect(a.errors).toEqual([
      expect.objectContaining({
        code: 'data:WRITE_FAILED',
        message: `could not persist an update of ${regionId}`,
      }),
    ])
  })

  it('imports what another tab wrote on a full pass, also while the channel is down', async () => {
    const { a } = await twoDevices()
    const follower = (
      await RegionDoc.open(a.local, { kind: 'private', id: regionId })
    )._unsafeUnwrap()

    a.transport.goOffline()
    writeName(follower, 'Bea')
    expect((await follower.flush()).isOk()).toBe(true)

    // The tab comes back into view: a full pass.
    a.engine.visibility('hidden')
    a.engine.visibility('visible')

    await vi.waitFor(() => expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Bea' }))
    follower.close()
  })

  it('compacts its local log on a full pass once it holds more rows than the limit past its snapshot, also offline', async () => {
    const gateway = await openGateway()
    const device = await openDevice(gateway, { localCompactionRows: 2 })

    device.transport.goOffline()
    device.engine.start()

    for (const name of ['Ann', 'Ana', 'Anna']) {
      writeName(device.region, name)
    }

    expect((await device.region.flush()).isOk()).toBe(true)

    // The tab comes back into view: a full pass.
    device.engine.visibility('hidden')
    device.engine.visibility('visible')

    await vi.waitFor(async () =>
      expect(await localCounts(device)).toEqual({ snapshots: 1, updates: 0 }),
    )
    expect((await device.region.outbox(10))._unsafeUnwrap()).toHaveLength(3)
    expect(device.errors).toEqual([])
  })

  it('compacts the local log of a device that only reads, grown by the updates it imported', async () => {
    const gateway = await openGateway()
    const writer = await openDevice(gateway)
    const reader = await openDevice(gateway, { localCompactionRows: 2 })
    const settle = () => settleAll([writer, reader])

    writer.engine.start()
    reader.engine.start()

    for (const name of ['Ann', 'Ana', 'Anna']) {
      writeName(writer.region, name)
      writer.engine.localWrite()
      await settle()
    }

    const imported = await localCounts(reader)

    // The subscription's answer is a row too: past the limit of 2, with no snapshot yet.
    expect(imported.snapshots).toBe(0)
    expect(imported.updates).toBeGreaterThan(2)

    // The tab comes back into view: a full pass.
    reader.engine.visibility('hidden')
    reader.engine.visibility('visible')

    await vi.waitFor(async () =>
      expect(await localCounts(reader)).toEqual({ snapshots: 1, updates: 0 }),
    )
    expect(reader.region.recordJson(profileKey)).toMatchObject({ name: 'Anna' })
    expect([...writer.errors, ...reader.errors]).toEqual([])
  })

  it('leaves alone on a connection a region its welcome does not name: no subscription, no probe, nothing pushed', async () => {
    // The device still holds the organisation's region; the gateway, which removed it from the
    // organisation while it was offline, no longer welcomes it there.
    const gateway = await openGateway({ schema: replicaSchema })
    const device = await openDevice(gateway, { identity: ann, region: acmeRegion })

    writeName(device.region, 'Ann')
    device.engine.start()
    device.engine.localWrite()
    // The tab comes back into view: a full pass probes and pushes.
    device.engine.visibility('hidden')
    device.engine.visibility('visible')
    await device.engine.settled(60_000)

    expect(device.channel()).toBe('up')
    expect(device.errors).toEqual([])
    // What it holds stays where it is, for the app to drop with the region.
    expect((await device.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('answers a sign-out offline while a region its welcome left out holds what it has not sent', async () => {
    const gateway = await openGateway({ schema: replicaSchema })
    const device = await openDevice(gateway, { identity: ann, region: acmeRegion })

    writeName(device.region, 'Ann')
    device.engine.start()
    await device.engine.settled(60_000)

    // The gateway could never take those rows: the sign-out leaves them for the app to weigh.
    expect(await driven(gateway.clock, device.engine.signOut())).toBe('offline')
    expect(device.errors).toEqual([])
  })

  it('resolves offline when a batch stays unanswered past the time a sign-out drains for', async () => {
    const { a, stub, clock } = await twoDevices()
    const swallowed = stub.swallowNextPush()

    writeName(a.region, 'Ana')
    const outcome = a.engine.signOut()

    await swallowed
    await clock.advance(10_000)

    expect(await outcome).toBe('offline')
    expect((await a.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('releases a push whose answer never comes after 30 seconds, then settles once it goes again', async () => {
    const { a, b, stub, clock, settle } = await twoDevices()
    const swallowed = stub.swallowNextPush()

    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await swallowed
    await clock.advance(30_000)

    expect(a.errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])

    a.engine.localWrite()
    await settle()

    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
  })

  it('connects again when a probe stays unanswered for 30 seconds, then settles', async () => {
    const { b, stub, clock } = await twoDevices()
    const swallowed = stub.swallowNextProbe()

    // The tab comes back into view: the full pass probes, and the answer never comes.
    b.engine.visibility('hidden')
    b.engine.visibility('visible')
    await swallowed

    const settling = b.engine.settled(120_000)

    expect(await hasSettled(settling)).toBe(false)

    await clock.advance(60_000)
    await settling

    expect(b.transport.reconnects()).toBe(1)
    expect(b.errors).toEqual([
      expect.objectContaining({
        code: 'data:QUERY_FAILED',
        message: 'the gateway did not answer a probe within 30000 ms',
      }),
    ])
  })

  it('connects again when a push stays unanswered for 30 seconds', async () => {
    const { a, stub, clock, settle } = await twoDevices()
    const swallowed = stub.swallowNextPush()

    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await swallowed
    await clock.advance(30_000)
    await settle()

    expect(a.transport.reconnects()).toBe(1)
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('subscribes again after the gateway failed to load the region, and pushes what waited', async () => {
    let failLoad = true
    const gateway = await openGateway({
      wrap: (server) =>
        interceptQueries(server, (text) => {
          if (failLoad && text === loadStatement) {
            failLoad = false
            throw new Error('the database went away')
          }
        }),
    })
    const a = await openDevice(gateway)

    a.engine.start()
    await vi.waitFor(() => expect(a.errors).toHaveLength(1))
    writeName(a.region, 'Ann')
    a.engine.localWrite()
    await settleAll([a])

    expect(a.errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect((await gateway.stub.hub.heads([regionId]))._unsafeUnwrap()).toEqual([
      { region: regionId, head: 1 },
    ])
  })

  it('keeps syncing after a protocol error, and repeats a refused pull on the next full pass', async () => {
    const { a, b, stub, settle } = await twoDevices()

    // b misses the batch naming the profile Ana, so the next one waits for it.
    stub.dropNextFanOutTo(b.transport)
    stub.refuseNextPull()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    writeName(a.region, 'Anna')
    a.engine.localWrite()
    await settle()

    expect(b.errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })

    b.engine.visibility('hidden')
    b.engine.visibility('visible')
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Anna' })

    writeName(a.region, 'Anne')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Anne' })
    expect(b.errors).toHaveLength(1)
  })

  it('keeps a batch the gateway failed to store and pushes it again on the next write', async () => {
    let failAccept = false
    const gateway = await openGateway({
      wrap: (server) =>
        interceptQueries(server, (text) => {
          if (failAccept && text === acceptStatement) {
            failAccept = false
            throw new Error('the database went away')
          }
        }),
    })
    const a = await openDevice(gateway)
    const b = await openDevice(gateway)

    a.engine.start()
    b.engine.start()
    await settleAll([a, b])
    failAccept = true
    writeName(a.region, 'Ann')
    a.engine.localWrite()
    // The batch stays unacknowledged, so the device does not settle: wait for the report.
    await vi.waitFor(() => expect(a.errors).toHaveLength(1))

    expect(a.errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect(gateway.stub.failures()).toEqual([
      expect.objectContaining({ code: 'data:WRITE_FAILED' }),
    ])
    expect((await a.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
    expect(b.region.recordJson(profileKey)).toBeUndefined()

    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settleAll([a, b])

    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
  })

  it('renew() asks the gateway for new keys over the welcomed channel, and does nothing while it is down', async () => {
    const { a, stub } = await twoDevices()

    stub.renewAtNextHello({ access: 'access-2', refresh: 'refresh-2' })

    expect(a.engine.renew()).toBe(true)
    expect(a.transport.renews()).toBe(1)
    expect(a.transport.reconnects()).toBe(0)

    a.transport.goOffline()

    expect(a.engine.renew()).toBe(false)
    expect(a.transport.renews()).toBe(1)
  })

  it('takes a renewal the gateway refuses for no error: nothing is reported and the regions sync on', async () => {
    const { a, b, stub, settle } = await twoDevices()

    stub.refuseRenewals()

    expect(a.engine.renew()).toBe(true)
    await settle()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
    expect(a.errors).toEqual([])
  })
})
