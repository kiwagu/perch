import { afterEach, describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'

import acceptStatement from '../server/surql/server-accept.surql'
import loadStatement from '../server/surql/server-load.surql'

import {
  closeDevices,
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
    const { a, stub } = await twoDevices()

    stub.rejectEverything()
    a.transport.goOffline()
    writeName(a.region, 'Ana')

    const outcome = a.engine.signOut()

    // The channel comes back during the sign-out; the drain's batch is rejected, rolled back
    // and rejected again, so the region stops with the rows and their inverse unsent.
    a.transport.goOnline()

    expect(await outcome).toBe('offline')
    expect(stub.signOuts()).toBe(0)
    expect(a.transport.online()).toBe(true)
    expect(a.errors.map((error) => error.code)).toContain('data:SYNC_STOPPED')
    expect((await a.region.outbox(10))._unsafeUnwrap().length).toBeGreaterThan(0)
  })

  it('reports offline when the channel stays down for 5 seconds', async () => {
    const { a, clock } = await twoDevices()

    a.transport.goOffline()
    const outcome = a.engine.signOut()

    await clock.advance(4_999)

    expect(await hasSettled(outcome)).toBe(false)

    await clock.advance(1)

    expect(await outcome).toBe('offline')
  })

  it('signs out once the channel comes back within 5 seconds', async () => {
    const { a, clock } = await twoDevices()

    a.transport.goOffline()
    const outcome = a.engine.signOut()

    await clock.advance(1_000)
    a.transport.goOnline()

    expect(await outcome).toBe('signed-out')
  })

  it('resolves signed-out 10 seconds after the sign-out when the gateway never closes the channel', async () => {
    const { a, stub, clock } = await twoDevices()
    const received = stub.keepOpenOnSignOut()
    const outcome = a.engine.signOut()

    await received
    await clock.advance(9_999)

    expect(await hasSettled(outcome)).toBe(false)

    await clock.advance(1)

    expect(await outcome).toBe('signed-out')
    expect(a.channel()).toBe('down')
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
})
