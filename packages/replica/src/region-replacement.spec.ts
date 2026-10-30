import { LoroMap } from 'loro-crdt'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import { identityId, profileId } from './__fixtures__/profile'
import countsStatement from './__fixtures__/replica-counts.surql'
import { RegionDoc, type RegionRef } from './region-doc'
import { replaceRegionDoc } from './region-replacement'
import { interceptRegionResets } from './testing'

const ref: RegionRef = { kind: 'private', id: `identity:${identityId}` }
const key = `profile/${profileId}`

let local: LocalDb

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

function writeName(region: RegionDoc, name: string): void {
  const record =
    region.recordJson(key) === undefined
      ? region.records().setContainer(key, new LoroMap())
      : region.recordMap(key)

  record.set('name', name)
  region.doc.commit()
}

async function outboxRows(): Promise<number> {
  const [, , outbox] = (await local.db.query(countsStatement, { region: ref.id })) as number[][]

  return outbox?.[0] ?? 0
}

describe('region document replacement', () => {
  it('reopen answers a document with what the database holds now and closes the one it replaces', async () => {
    const writer = (await RegionDoc.open(local, ref))._unsafeUnwrap()
    const current = (await RegionDoc.open(local, ref))._unsafeUnwrap()

    writeName(writer, 'Ann')
    expect((await writer.flush()).isOk()).toBe(true)

    const next = (await replaceRegionDoc(local, current, 'reopen'))._unsafeUnwrap()

    expect(next.recordJson(key)).toMatchObject({ name: 'Ann' })

    writeName(current, 'Closed')
    expect((await current.flush()).isOk()).toBe(true)
    expect(await outboxRows()).toBe(1)
  })

  it('a reset the database refuses changes nothing', async () => {
    const refusing = interceptRegionResets(local, () => {
      throw new Error('the database refuses the reset')
    })
    const current = (await RegionDoc.open(refusing, ref))._unsafeUnwrap()

    writeName(current, 'Ann')
    expect((await current.flush()).isOk()).toBe(true)
    expect((await replaceRegionDoc(refusing, current, 'reset')).isErr()).toBe(true)

    writeName(current, 'Ana')
    expect((await current.flush()).isOk()).toBe(true)
    expect(await outboxRows()).toBe(2)
  })

  it('a held reset completes once released', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = interceptRegionResets(local, () => gate)
    const current = (await RegionDoc.open(holding, ref))._unsafeUnwrap()
    let done = false
    const replaced = replaceRegionDoc(holding, current, 'reset').map((next) => {
      done = true

      return next
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)

    release()

    expect((await replaced)._unsafeUnwrap()).not.toBe(current)
  })
})
