/**
 * Measures what checking a pushed batch costs the server on this machine. For a private
 * region holding 10, 100 and 1000 profile-shaped records (the owner's identity, a name, a
 * short bio), 200 batches of 1 change and 200 batches of 20 changes go through
 * `validateBatch`, which applies each batch to a fork of the authoritative document. A
 * change is one commit of a device that edits one existing record (a new name or a word
 * added to the bio), exported as the update the device's outbox holds; the device holds a
 * copy of the authoritative document under a peer of its own, as after a pull. Each accepted
 * batch is then imported into the authoritative document, as the region hub does, so the
 * next batch follows it. Beside the validation times the table shows the time of
 * `doc.fork()` alone, on a document of the same size that has just imported a change, and
 * the size of the authoritative document's snapshot before the batches. Everything but the
 * timing is deterministic: record ids, peers and edits are fixed.
 *
 * Usage: bun run --filter @workspace/replica measure:validation
 */

import { LoroDoc, LoroMap, LoroText } from 'loro-crdt'

import { recordKey } from '../src/keys'
import { validateBatch } from '../src/server'
import { input, owner } from '../src/server/__fixtures__/batch'

const RECORD_COUNTS = [10, 100, 1000] as const
const CHANGES_PER_BATCH = [1, 20] as const
const BATCHES = 200
const FORKS = 200
const WARM_UP_BATCHES = 50
const SERVER_PEER = 1n
const DEVICE_PEER = 2n

interface Row {
  readonly records: number
  readonly changes: number
  readonly validateP50: number
  readonly validateP95: number
  readonly forkP50: number
  readonly forkP95: number
  readonly snapshotKiB: number
}

const keyOf = (index: number): string =>
  recordKey('profile', `prf_${String(index).padStart(4, '0')}`)

/** The value below which `share` of the samples fall (nearest rank). */
function percentile(samples: readonly number[], share: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(share * sorted.length))

  return sorted[rank - 1] ?? Number.NaN
}

function newDoc(peer: bigint): LoroDoc {
  const doc = new LoroDoc()

  doc.setPeerId(peer)
  doc.setRecordTimestamp(true)

  return doc
}

/** The server's copy of the owner's private region, one commit per record, as devices make them. */
function authoritativeDocument(count: number): LoroDoc {
  const doc = newDoc(SERVER_PEER)
  const records = doc.getMap('records')

  for (let index = 0; index < count; index++) {
    const profile = records.setContainer(keyOf(index), new LoroMap())

    profile.set('identity', owner)
    profile.set('name', `Person ${index}`)
    profile.set('created_at', '2026-10-16T09:00:00.000Z')
    profile.ensureMergeableText('bio').insert(0, `Bio of person ${index}`)
    doc.commit()
  }

  return doc
}

/** A device's copy of the authoritative document, editing under a peer of its own. */
function deviceOf(doc: LoroDoc): LoroDoc {
  const device = newDoc(DEVICE_PEER)

  device.import(doc.export({ mode: 'snapshot' }))

  return device
}

function profileOf(device: LoroDoc, index: number): LoroMap {
  const profile = device.getMap('records').get(keyOf(index))

  if (!(profile instanceof LoroMap)) {
    throw new Error(`${keyOf(index)} is not a map on the device`)
  }

  return profile as LoroMap
}

/**
 * The updates of one batch: `changes` commits, each editing the next record in turn, the
 * even steps renaming it and the odd ones adding a word to its bio.
 */
function batchOf(device: LoroDoc, firstStep: number, changes: number, count: number): Uint8Array[] {
  return Array.from({ length: changes }, (_, offset) => {
    const step = firstStep + offset
    const index = step % count
    const profile = profileOf(device, index)
    const before = device.version()

    if (step % 2 === 0) {
      profile.set('name', `Person ${index} (${step})`)
    } else {
      const bio = profile.get('bio')

      if (!(bio instanceof LoroText)) {
        throw new Error(`${keyOf(index)}.bio is not a text on the device`)
      }

      bio.insert(bio.length, ` ${step}`)
    }

    device.commit()

    return device.export({ mode: 'update', from: before })
  })
}

/**
 * Validates `batches` batches against the document and imports each accepted one, as the hub
 * does; returns the time of each `validateBatch` call.
 */
function validateBatches(doc: LoroDoc, count: number, changes: number, batches: number): number[] {
  const device = deviceOf(doc)
  const touched = Math.min(changes, count)
  const times: number[] = []

  for (let batch = 0; batch < batches; batch++) {
    const updates = batchOf(device, batch * changes, changes, count)
    const start = performance.now()
    const validated = validateBatch(input(doc, updates))

    times.push(performance.now() - start)

    if (validated.isErr()) {
      throw new Error(
        `batch ${batch} was refused: ${validated.error.reason} ${validated.error.detail}`,
      )
    }

    const { plan } = validated.value

    if (plan.upserts.length !== touched || plan.deletes.length > 0) {
      throw new Error(`batch ${batch} planned ${plan.upserts.length} upserts, expected ${touched}`)
    }

    doc.import(plan.bytes)
  }

  return times
}

/**
 * Times `doc.fork()` as a push meets it: each fork follows the import of one more change.
 * A document unchanged since its previous fork forks several times faster, which only a push
 * after a refused batch meets.
 */
function forkTimes(doc: LoroDoc, count: number): number[] {
  const device = deviceOf(doc)

  return Array.from({ length: FORKS }, (_, step) => {
    for (const update of batchOf(device, step, 1, count)) {
      doc.import(update)
    }

    const start = performance.now()
    const fork = doc.fork()
    const time = performance.now() - start

    fork.free()

    return time
  })
}

function measure(count: number, changes: number): Row {
  const doc = authoritativeDocument(count)
  const snapshotKiB = doc.export({ mode: 'snapshot' }).byteLength / 1024
  const validations = validateBatches(doc, count, changes, BATCHES)
  const forks = forkTimes(authoritativeDocument(count), count)

  return {
    records: count,
    changes,
    validateP50: percentile(validations, 0.5),
    validateP95: percentile(validations, 0.95),
    forkP50: percentile(forks, 0.5),
    forkP95: percentile(forks, 0.95),
    snapshotKiB,
  }
}

function table(rows: readonly Row[]): string {
  const header = [
    'records',
    'changes/batch',
    'validate p50 ms',
    'validate p95 ms',
    'fork p50 ms',
    'fork p95 ms',
    'snapshot KiB',
  ]
  const lines = rows.map((row) => [
    String(row.records),
    String(row.changes),
    row.validateP50.toFixed(3),
    row.validateP95.toFixed(3),
    row.forkP50.toFixed(3),
    row.forkP95.toFixed(3),
    row.snapshotKiB.toFixed(1),
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column]?.length ?? 0)),
  )
  const format = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padStart(widths[column] ?? 0)).join(' | ')} |`

  return [
    format(header),
    `|${widths.map((width) => `${'-'.repeat(width + 1)}:`).join('|')}|`,
    ...lines.map(format),
  ].join('\n')
}

// The first batches pay for compiling the code paths; they are not part of any row.
validateBatches(authoritativeDocument(RECORD_COUNTS[0]), RECORD_COUNTS[0], 1, WARM_UP_BATCHES)

const rows = RECORD_COUNTS.flatMap((count) =>
  CHANGES_PER_BATCH.map((changes) => measure(count, changes)),
)

console.log(
  `validateBatch on a fork, ${BATCHES} batches per row, doc.fork() ${FORKS} times per row, bun ${Bun.version}`,
)
console.log(table(rows))
