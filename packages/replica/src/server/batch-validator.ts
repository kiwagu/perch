import { type Frontiers, type ImportStatus, type LoroDoc, LoroMap } from 'loro-crdt'
import { err, ok, type Result } from 'neverthrow'

import { splitRecordKey } from '../keys'
import { toColumns } from '../projection-values'
import type { RejectReason } from '../protocol'
import type { RegionRef } from '../region-doc'
import { fieldOf, type ReplicaSchema, tablesOf } from '../schema'

import type { AcceptPlan, DeletedRow, ProjectedRow } from './region-log'

/** Why the server refuses a pushed batch, with the record or the cause it refuses. */
export interface BatchRejection {
  readonly reason: RejectReason
  readonly detail: string
}

/** A batch that passed validation: the document with the batch applied, and the plan the log accepts. */
export interface ValidatedBatch {
  readonly fork: LoroDoc
  readonly plan: AcceptPlan
}

export interface ValidateBatchInput {
  /** The authoritative document of the region; validation never modifies it. */
  readonly doc: LoroDoc
  readonly region: RegionRef
  /** The identity id (its key) of the device that pushed the batch. */
  readonly actor: string
  readonly schema: ReplicaSchema
  readonly updates: readonly Uint8Array[]
}

const RECORDS = 'records'

function writesOutside(container: string): BatchRejection {
  return { reason: 'malformed', detail: `writes outside ${RECORDS}: ${container}` }
}

/**
 * The keys of the records a document changed between two versions: the keys the `records`
 * map itself changed, and the record that holds each changed container nested inside one.
 * A change to any other root container is refused: nothing projects it, so it would only
 * be stored and replicated. A root is a name and a type, while a path names only the root,
 * so a root of another type under the name `records` is told apart by its container id.
 */
function touchedRecordKeys(
  doc: LoroDoc,
  from: Frontiers,
  to: Frontiers,
): Result<Set<string>, BatchRejection> {
  const records = doc.getMap(RECORDS).id
  const touched = new Set<string>()

  for (const [container, diff] of doc.diff(from, to, false)) {
    const path = doc.getPathToContainer(container)

    if (!path) {
      continue
    }

    if (path[0] !== RECORDS) {
      return err(writesOutside(String(path[0])))
    }

    // No root other than the records map was ever accepted, so a write into one changes the root itself.
    if (path.length === 1 && container !== records) {
      return err(writesOutside(container))
    }

    if (path.length > 1) {
      touched.add(String(path[1]))
    } else if (diff.type === 'map') {
      for (const key of Object.keys(diff.updated)) {
        touched.add(key)
      }
    }
  }

  return ok(touched)
}

/** Fields that reference the pushing identity: `identity` in a private region, `member` in a tenant region. */
function ownerTable(region: RegionRef): string {
  return region.kind === 'tenant' ? 'member' : 'identity'
}

/**
 * The first field that breaks the owner rule. In a private region every identity reference is
 * the region's owner. In a tenant region a record created by the batch references the pushing
 * member only, and a record it updates keeps the member references it had: who wrote a note is
 * not something another member can change.
 */
function foreignOwner(
  input: ValidateBatchInput,
  table: string,
  value: Readonly<Record<string, unknown>>,
  before: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const owner = `${ownerTable(input.region)}:${input.actor}`

  return Object.keys(value).find((field) => {
    const kind = fieldOf(input.schema, table, field)

    if (kind?.kind !== 'record' || kind.table !== ownerTable(input.region)) {
      return false
    }

    if (input.region.kind === 'private' || before === undefined) {
      return value[field] !== owner
    }

    return value[field] !== before[field]
  })
}

/**
 * Applies a pushed batch to a fork of the authoritative document and checks what it changed:
 * it writes nothing outside the `records` map, and every record it touched belongs to a table
 * of the region, is a map, and keeps the owner rule (`foreignOwner`): in a private region it
 * references no identity but the owner's, in a tenant region a new record names the pushing
 * member and an existing one keeps the members it named.
 * The result is the plan the region's log accepts: the projection of each touched record,
 * the update bytes and the version after the batch. A record the batch creates and deletes
 * again is no change. A refused batch is a value, never a throw, and the authoritative
 * document stays as it was either way.
 */
export function validateBatch(input: ValidateBatchInput): Result<ValidatedBatch, BatchRejection> {
  const fork = input.doc.fork()
  const from = input.doc.frontiers()
  let status: ImportStatus

  try {
    status = fork.importBatch([...input.updates])
  } catch (cause) {
    return err({ reason: 'malformed', detail: String(cause) })
  }

  if (status.pending && status.pending.size > 0) {
    return err({
      reason: 'pending-dependencies',
      detail: 'the batch depends on changes the server does not have',
    })
  }

  const touched = touchedRecordKeys(fork, from, fork.frontiers())

  if (touched.isErr()) {
    return err(touched.error)
  }

  const before = input.doc.getMap(RECORDS)
  const after = fork.getMap(RECORDS)
  const allowed = new Set(tablesOf(input.schema, input.region.kind))
  const upserts: ProjectedRow[] = []
  const deletes: DeletedRow[] = []

  for (const entry of touched.value) {
    const record: unknown = after.get(entry)

    if (record === undefined && before.get(entry) === undefined) {
      continue
    }

    const split = splitRecordKey(entry)

    if (!split || !allowed.has(split.table)) {
      return err({ reason: 'foreign-table', detail: entry })
    }

    if (record === undefined) {
      deletes.push({ ...split, entry })
      continue
    }

    if (!(record instanceof LoroMap)) {
      return err({ reason: 'invalid-record', detail: `${entry} is not a map` })
    }

    const value = record.toJSON() as Record<string, unknown>
    const previous: unknown = before.get(entry)
    const prior =
      previous instanceof LoroMap ? (previous.toJSON() as Record<string, unknown>) : undefined
    const foreign = foreignOwner(input, split.table, value, prior)

    if (foreign) {
      return err({ reason: 'foreign-owner', detail: `${entry}.${foreign}` })
    }

    upserts.push({ ...split, entry, data: toColumns(input.schema, split.table, value) })
  }

  return ok({
    fork,
    plan: {
      upserts,
      deletes,
      bytes: fork.export({ mode: 'update', from: input.doc.version() }),
      version: fork.version().encode(),
    },
  })
}
