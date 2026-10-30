import { LoroDoc } from 'loro-crdt'
import { describe, expect, it } from 'vitest'

import { noteCreate } from '../__fixtures__/note'

import { batchWriter } from './batch-writer'

/** A region's document after it took in `updates`, and a fork of it that took in `batch` too. */
function regionAnd(updates: readonly Uint8Array[], batch: readonly Uint8Array[]) {
  const doc = new LoroDoc()

  for (const update of updates) {
    doc.import(update)
  }

  const fork = doc.fork()

  fork.importBatch([...batch])

  return { doc, fork }
}

/** A device's document writing as `peer`, holding what the region holds. */
function deviceAs(peer: `${number}`, holding: readonly Uint8Array[] = []): LoroDoc {
  const doc = new LoroDoc()

  doc.setPeerId(peer)

  for (const update of holding) {
    doc.import(update)
  }

  return doc
}

describe('batch writer', () => {
  it('names the peer of each change a batch brings that the region lacks', () => {
    const device = deviceAs('42')
    const { doc, fork } = regionAnd(
      [],
      [noteCreate(device, { id: 'n1', author: 'idn_a', text: 'a' })],
    )

    expect(batchWriter('idn_a', doc, fork).peers).toEqual(['42'])
  })

  it('names no peer for changes the region holds already', () => {
    const device = deviceAs('42')
    const held = noteCreate(device, { id: 'n1', author: 'idn_a', text: 'a' })
    const { doc, fork } = regionAnd([held], [held])

    expect(batchWriter('idn_a', doc, fork).peers).toEqual([])
  })

  it('names only the new peers of a batch that carries held changes beside its own', () => {
    const ann = deviceAs('42')
    const held = noteCreate(ann, { id: 'n1', author: 'idn_ann', text: 'a' })
    const bob = deviceAs('7', [held])
    const own = noteCreate(bob, { id: 'n2', author: 'idn_bob', text: 'b' })
    const { doc, fork } = regionAnd([held], [held, own])

    expect(batchWriter('idn_bob', doc, fork).peers).toEqual(['7'])
  })

  it('names every peer of a batch that carries changes of several', () => {
    const tab = deviceAs('42')
    const other = deviceAs('43')
    const first = noteCreate(tab, { id: 'n1', author: 'idn_a', text: 'a' })
    const second = noteCreate(other, { id: 'n2', author: 'idn_a', text: 'b' })
    const { doc, fork } = regionAnd([], [first, second])

    expect([...batchWriter('idn_a', doc, fork).peers].sort()).toEqual(['42', '43'])
  })

  it('carries the identity that pushed the batch', () => {
    const { doc, fork } = regionAnd([], [])

    expect(batchWriter('idn_a', doc, fork)).toEqual({ identity: 'idn_a', peers: [] })
  })
})
