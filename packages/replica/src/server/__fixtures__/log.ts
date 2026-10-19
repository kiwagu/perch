import { type Frontiers, LoroDoc, LoroMap, type VersionVector } from 'loro-crdt'

import type { LocalDb } from '@workspace/data'

import { profileSchema } from '../../__fixtures__/profile'
import { toColumns } from '../../projection-values'
import type { BatchWriter } from '../batch-writer'
import type { AcceptPlan, RegionLog } from '../region-log'

import boundIdentityStatement from './bound-identity.surql'
import countRowsStatement from './count-rows.surql'
import storedProfileStatement from './stored-profile.surql'
import storedSnapshotStatement from './stored-snapshot.surql'

export const region = 'identity:idn_a'

/** The writer of the batches these tests accept: the owner, with peers these tests do not follow. */
export const ownerWriter: BatchWriter = { identity: 'idn_a', peers: [] }

/** The identity peer `peer` of `inRegion` writes as; undefined while the peer is free. */
export async function boundIdentity(
  local: LocalDb,
  inRegion: string,
  peer: string,
): Promise<string | undefined> {
  const [identity] = await local.db.query<[string | null | undefined]>(boundIdentityStatement, {
    region: inRegion,
    peer,
  })

  return identity ?? undefined
}

/** The frontiers of a document right after each of its accepted edits, by the edit's seq. */
const acceptedAt = new WeakMap<LoroDoc, Map<number, Frontiers>>()

/**
 * Commits one edit that names profile `key` of `owner` in the document, creating the profile
 * when it is missing, and plans it as the server would: the edit's update bytes, the document
 * version after it and the profile's projection.
 */
function commitName(doc: LoroDoc, name: string, key: string, owner: string): AcceptPlan {
  const entry = `profile/${key}`
  const from = doc.version()
  const record = doc.getMap('records').getOrCreateContainer(entry, new LoroMap())

  record.set('identity', owner)
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

/** The plan of one edit that names profile `key` of `owner` in a document of its own. */
export function planFor(name: string, key = 'prf_1', owner = region): AcceptPlan {
  return commitName(new LoroDoc(), name, key, owner)
}

/** A plan that deletes profile `key` and writes nothing, as a batch of a region of `owner`. */
export function deletionOf(key: string, owner: string): AcceptPlan {
  return {
    ...planFor('Gone', `${key}_unused`, owner),
    upserts: [],
    deletes: [{ table: 'profile', key, entry: `profile/${key}` }],
  }
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
    const seq = (
      await log.accept(commitName(doc, name, 'prf_1', region), {
        identity: 'idn_a',
        peers: [doc.peerIdStr],
      })
    )._unsafeUnwrap()

    frontiers.set(seq, doc.frontiers())
  }
}

function frontiersAt(doc: LoroDoc, seq: number): Frontiers {
  const frontiers = acceptedAt.get(doc)?.get(seq)

  if (!frontiers) {
    throw new Error(`no edit of this document was accepted as ${seq}`)
  }

  return frontiers
}

/** A snapshot of the document as it was right after the edit the log accepted as `seq`. */
export function snapshotAt(doc: LoroDoc, seq: number): Uint8Array {
  return doc.forkAt(frontiersAt(doc, seq)).export({ mode: 'snapshot' })
}

/** Exports the document at a version of its history as a full snapshot, as the hub does for the log. */
export function snapshotsOf(doc: LoroDoc): (version: VersionVector) => Uint8Array {
  return (version) => doc.forkAt(doc.vvToFrontiers(version)).export({ mode: 'snapshot' })
}

/**
 * A history forged under the identity of `doc`'s author: a document of its own that reuses
 * `doc`'s peer id and makes one edit per name exactly as the fixtures make them, so each edit
 * takes the same counters as the original one and the version vectors match, while the
 * names, the contents, differ.
 */
export function forgedHistory(doc: LoroDoc, names: readonly string[]): LoroDoc {
  const forged = new LoroDoc()

  forged.setPeerId(doc.peerIdStr)

  for (const name of names) {
    commitName(forged, name, 'prf_1', region)
  }

  return forged
}

/** The document the snapshot stored for the region holds; undefined while it has none. */
export async function storedSnapshot(local: LocalDb): Promise<LoroDoc | undefined> {
  const [[bytes]] = await local.db.query<[ArrayBuffer[]]>(storedSnapshotStatement, { region })

  if (!bytes) {
    return undefined
  }

  const doc = new LoroDoc()

  doc.import(new Uint8Array(bytes))

  return doc
}

/** Like `snapshotAt`, but shallow: the history before that edit is left out. */
export function shallowSnapshotAt(doc: LoroDoc, seq: number): Uint8Array {
  const frontiers = frontiersAt(doc, seq)

  return doc.forkAt(frontiers).export({ mode: 'shallow-snapshot', frontiers })
}

/** The name and the owner of profile `key` as its table holds them; undefined when it is gone. */
export async function storedProfile(
  local: LocalDb,
  key: string,
): Promise<{ readonly name: string; readonly identity: string } | undefined> {
  const [rows] = await local.db.query<[Array<{ name: string; identity: string }>]>(
    storedProfileStatement,
    { key },
  )

  return rows[0]
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
