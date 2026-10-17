import {
  type ContainerID,
  type Frontiers,
  type ImportStatus,
  type LoroDoc,
  LoroMap,
} from 'loro-crdt'
import { err, ok, type Result } from 'neverthrow'

import type { Ability, Action } from '@workspace/kernel'

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
  /** What that device's member may do to the region's records. */
  readonly ability: Ability
  readonly schema: ReplicaSchema
  readonly updates: readonly Uint8Array[]
}

const RECORDS = 'records'

/** The prefix of the name Loro gives a mergeable container (a record's text), a root in the operations. */
const MERGEABLE_ROOT = 'cid:root-🤝:'

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

const forbidden = (entry: string, action: Action): BatchRejection => ({
  reason: 'forbidden-action',
  detail: `${entry}:${action}`,
})

/**
 * A root container other than the records map that an operation of the batch wrote, read from
 * the operations themselves: a write a later operation of the same batch undid is refused too,
 * because the operations would still be stored and replicated. The mergeable containers of a
 * record's fields are roots in the operations, and they are not foreign: one is told apart by
 * its name and by the path to it, which leads into the records. A mergeable container whose
 * record the batch removed has no path any more and is the removal's own.
 */
function foreignRoot(doc: LoroDoc, fork: LoroDoc): string | undefined {
  const records = fork.getMap(RECORDS).id

  for (const change of fork.exportJsonUpdates(doc.version(), fork.version()).changes) {
    for (const op of change.ops) {
      if (!op.container.startsWith('cid:root-') || op.container === records) {
        continue
      }

      const path = fork.getPathToContainer(op.container as ContainerID)
      const mergeable = op.container.startsWith(MERGEABLE_ROOT)

      if (mergeable ? path !== undefined && path[0] !== RECORDS : true) {
        return op.container
      }
    }
  }

  return undefined
}

/** Fields that reference the pushing identity: `identity` in a private region, `member` in a tenant region. */
function ownerTable(region: RegionRef): string {
  return region.kind === 'tenant' ? 'member' : 'identity'
}

/**
 * The first field that breaks the owner rule. In a private region every identity reference is
 * the region's owner. In a tenant region a record created by the batch references the pushing
 * member only, and a record it updates keeps the member references it had, none added, changed
 * or removed: who wrote a note is not something another member can change.
 */
function foreignOwner(
  input: ValidateBatchInput,
  table: string,
  value: Readonly<Record<string, unknown>>,
  before: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const owner = `${ownerTable(input.region)}:${input.actor}`
  // Every reference names the pushing identity: any in a private region, or in a new record.
  const actorOnly = input.region.kind === 'private' || before === undefined
  // An updated record is checked on the fields it had too: a removed reference is gone from `value`.
  const fields = actorOnly
    ? Object.keys(value)
    : [...new Set([...Object.keys(before), ...Object.keys(value)])]

  return fields.find((field) => {
    const kind = fieldOf(input.schema, table, field)

    if (kind?.kind !== 'record' || kind.table !== ownerTable(input.region)) {
      return false
    }

    return actorOnly ? value[field] !== owner : value[field] !== before[field]
  })
}

/**
 * Applies a pushed batch to a fork of the authoritative document and checks what it changed:
 * it writes nothing outside the `records` map, and every record it touched belongs to a table
 * of the region, is a map, and keeps the owner rule (`foreignOwner`): in a private region it
 * references no identity but the owner's, in a tenant region a new record names the pushing
 * member and an existing one keeps the members it named, and the member's ability allows the
 * action on the record (`forbidden-action`): a record is judged as it is, the one being
 * changed or deleted as it was, the new one as it is.
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

  const root = foreignRoot(input.doc, fork)

  if (root) {
    return err(writesOutside(root))
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
    const previous: unknown = before.get(entry)

    if (record === undefined && previous === undefined) {
      continue
    }

    const split = splitRecordKey(entry)

    if (!split || !allowed.has(split.table)) {
      return err({ reason: 'foreign-table', detail: entry })
    }

    const prior =
      previous instanceof LoroMap ? (previous.toJSON() as Record<string, unknown>) : undefined

    if (record === undefined) {
      if (!input.ability.can('delete', split.table, prior)) {
        return err(forbidden(entry, 'delete'))
      }

      deletes.push({ ...split, entry })
      continue
    }

    if (!(record instanceof LoroMap)) {
      return err({ reason: 'invalid-record', detail: `${entry} is not a map` })
    }

    const value = record.toJSON() as Record<string, unknown>
    const action: Action = prior === undefined ? 'create' : 'update'

    // A record is judged as it is: the one being changed, or the new one being created.
    if (!input.ability.can(action, split.table, action === 'create' ? value : prior)) {
      return err(forbidden(entry, action))
    }

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
