import { afterEach, describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'

import acceptStatement from '../server/surql/server-accept.surql'

import {
  closeDevices,
  openDevice,
  openGateway,
  profileKey,
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
    const { a, b, settle } = await twoDevices()

    writeName(a.region, 'Ana')

    expect(await a.engine.signOut()).toBe('signed-out')
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(a.channel()).toBe('down')
    expect(a.transport.online()).toBe(false)

    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
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
