import { okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory } from '@workspace/ids'
import { privateRegionId, RegionDoc, type RegionRef, replaceRegionDoc } from '@workspace/replica'
import { type SyncHint, syncHints } from '@workspace/replica/sync'
import { FakeHintChannel } from '@workspace/replica/testing'

import { RegionReloads } from './region-reloads'
import { openRegionSpace, type RegionSpace } from './region-space'

const ref: RegionRef = { kind: 'private', id: privateRegionId(identityIdFactory.create()) }

let local: LocalDb
let space: RegionSpace
let heard: SyncHint[]
let errors: DataError[]
let reloads: RegionReloads

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  space = (
    await openRegionSpace({
      openLocal: () => okAsync({ ...local, close: async () => {}, destroy: async () => {} }),
      ref,
      schema: replicaSchema,
      onError: () => {},
    })
  )._unsafeUnwrap()
  heard = []
  errors = []

  const bus = new Set<FakeHintChannel>()

  syncHints(new FakeHintChannel(bus)).on((hint) => heard.push(hint))
  reloads = new RegionReloads({
    spaces: () => [space],
    hints: syncHints(new FakeHintChannel(bus)),
    onError: (error) => errors.push(error),
  })
})

afterEach(async () => {
  await space.close()
  await local.close()
})

describe('region reloads', () => {
  it('replace answers the new document and, after a reset, posts the reset hint', async () => {
    const reset = (await reloads.replace(space.region, 'reset'))._unsafeUnwrap()

    expect(space.region).toBe(reset)
    expect(heard).toEqual(['reset'])

    ;(await reloads.replace(space.region, 'reopen'))._unsafeUnwrap()

    expect(heard).toEqual(['reset'])
  })

  it('reloadStale reopens only the regions another tab reset', async () => {
    const before = space.region

    await reloads.reloadStale()
    expect(space.region).toBe(before)

    ;(
      await replaceRegionDoc(local, (await RegionDoc.open(local, ref))._unsafeUnwrap(), 'reset')
    )._unsafeUnwrap()
    await reloads.reloadStale()

    expect(space.region).not.toBe(before)
    expect((await space.region.stale())._unsafeUnwrap()).toBe(false)
    expect(errors).toEqual([])
  })

  it('replace of a region no space holds fails data:OPEN_FAILED', async () => {
    const elsewhere = RegionDoc.inMemory('private', 'identity:idn_elsewhere')

    expect((await reloads.replace(elsewhere, 'reset'))._unsafeUnwrapErr().code).toBe(
      'data:OPEN_FAILED',
    )
  })
})
