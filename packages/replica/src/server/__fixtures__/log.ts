import { type Frontiers, LoroDoc, LoroMap } from 'loro-crdt'

import type { LocalDb } from '@workspace/data'

import { profileSchema } from '../../__fixtures__/profile'
import { toColumns } from '../../projection-values'
import type { AcceptPlan, RegionLog } from '../region-log'

import countRowsStatement from './count-rows.surql'

export const region = 'identity:idn_a'

/** The frontiers of a document right after each of its accepted edits, by the edit's seq. */
const acceptedAt = new WeakMap<LoroDoc, Map<number, Frontiers>>()

/**
 * Commits one edit that names profile `key` in the document, creating the profile when it is
 * missing, and plans it as the server would: the edit's update bytes, the document version
 * after it and the profile's projection.
 */
function commitName(doc: LoroDoc, name: string, key: string): AcceptPlan {
  const entry = `profile/${key}`
  const from = doc.version()
  const record = doc.getMap('records').getOrCreateContainer(entry, new LoroMap())

  record.set('identity', region)
  record.set('email', 'ann@example.test')
  record.set('name', name)
  doc.commit()

  return {
    upserts: [
      {
        table: 'profile',
        key,
        entry,
        data: toColumns(profileSchema, 'profile', record.toJSON() as Record<string, unknown>),
      },
    ],
    deletes: [],
    bytes: doc.export({ mode: 'update', from }),
    version: doc.version().encode(),
  }
}

/** The plan of one edit that names profile `key` in a document of its own. */
export function planFor(name: string, key = 'prf_1'): AcceptPlan {
  return commitName(new LoroDoc(), name, key)
}

/** Commits each name into `doc` as one edit and has the log accept it, in order. */
export async function acceptEdits(
  log: RegionLog,
  doc: LoroDoc,
  names: readonly string[],
): Promise<void> {
  const frontiers = acceptedAt.get(doc) ?? new Map<number, Frontiers>()

  acceptedAt.set(doc, frontiers)

  for (const name of names) {
    const seq = (await log.accept(commitName(doc, name, 'prf_1')))._unsafeUnwrap()

    frontiers.set(seq, doc.frontiers())
  }
}

/** A snapshot of the document as it was right after the edit the log accepted as `seq`. */
export function snapshotAt(doc: LoroDoc, seq: number): Uint8Array {
  const frontiers = acceptedAt.get(doc)?.get(seq)

  if (!frontiers) {
    throw new Error(`no edit of this document was accepted as ${seq}`)
  }

  return doc.forkAt(frontiers).export({ mode: 'snapshot' })
}

export async function countRows(local: LocalDb, table: string): Promise<number> {
  const [counts] = await local.db.query<[number[]]>(countRowsStatement, { table })

  return counts[0] ?? 0
}

/** The name of the profile the fixtures edit, as the document holds it. */
export function nameIn(doc: LoroDoc): unknown {
  const records = doc.getMap('records').toJSON() as Record<string, Record<string, unknown>>

  return records['profile/prf_1']?.['name']
}
