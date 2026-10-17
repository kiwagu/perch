import { LoroMap } from 'loro-crdt'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDevices, profileKey, twoDevices, writeBio, writeName } from './__fixtures__/devices'

afterEach(async () => {
  expect(await closeDevices()).toEqual([])
})

describe('region sync through the gateway', () => {
  it('carries an edit from one device to the other', async () => {
    const { a, b, settle } = await twoDevices()

    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
    expect(b.region.pulled()).toBe(a.region.pulled())
  })

  it('keeps an offline edit and delivers it when the channel returns', async () => {
    const { a, b, settle } = await twoDevices()

    b.transport.goOffline()
    writeBio(b.region, 'offline words')
    b.engine.localWrite()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    b.transport.goOnline()
    await settle()

    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Ana', bio: 'offline words' })
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana', bio: 'offline words' })
    expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('pulls when a pushed update skips a sequence number', async () => {
    const { a, b, stub, settle } = await twoDevices()

    // b misses the batch that names the profile Ana.
    stub.dropNextFanOutTo(b.transport)
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    writeName(a.region, 'Anna')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Anna' })
    expect(b.region.pulled()).toBe(a.region.pulled())
  })

  it('rolls a rejected batch back with its inverse and gets the pair accepted', async () => {
    const { a, b, settle, stub } = await twoDevices()

    // A table outside the region.
    a.region.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    a.region.doc.commit()
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson('note/n_1')).toBeUndefined()
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(stub.rejections()).toBe(1)
    expect(b.region.recordJson('note/n_1')).toBeUndefined()
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })
  })

  it('brings back the text of a field a rejected batch deleted, without doubling it', async () => {
    const { a, b, settle } = await twoDevices()

    writeBio(a.region, 'kept words')
    a.engine.localWrite()
    await settle()
    // One batch deletes the text field and writes a table outside the region.
    a.region.recordMap(profileKey).delete('bio')
    a.region.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    a.region.doc.commit()
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson(profileKey)).toMatchObject({ bio: 'kept words' })
    expect(b.region.recordJson(profileKey)).toMatchObject({ bio: 'kept words' })
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('stops syncing a region whose rollback is rejected too, and reports it', async () => {
    const { a, settle, stub, errors } = await twoDevices()

    stub.rejectEverything()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(errors()).toEqual([expect.objectContaining({ code: 'data:SYNC_STOPPED' })])
    expect(stub.rejections()).toBe(2)
    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })
  })

  it('proposes a compaction when asked and quiet', async () => {
    const { a, settle, stub } = await twoDevices({ compactionLogLimit: 1 })

    writeName(a.region, 'A')
    a.engine.localWrite()
    await settle()
    writeName(a.region, 'B')
    a.engine.localWrite()
    await settle()

    // The profile was created as the first batch; naming it A made the second.
    expect(stub.compactions()).toEqual([{ covers: 2, outcome: 'accepted' }])
  })
})
