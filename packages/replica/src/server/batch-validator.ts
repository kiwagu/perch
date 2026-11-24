import { type Frontiers, isContainer, type LoroDoc, LoroMap } from 'loro-crdt'
import { err, ok, Result } from 'neverthrow'

import type { Ability, Action } from '@workspace/kernel'

import { splitRecordKey } from '../keys'
import { toColumns } from '../projection-values'
import type { RejectReason } from '../protocol'
import type { RegionRef } from '../region-doc'
import { sameValue } from '../same-value'
import { fieldOf, type ReplicaSchema, readonlyFieldsOf, tablesOf } from '../schema'

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

/** Runs a Loro call on what the batch brought: one that throws on crafted bytes refuses the batch. */
function fromLoro<T>(call: () => T): Result<T, BatchRejection> {
  return Result.fromThrowable(
    call,
    (cause): BatchRejection => ({ reason: 'malformed', detail: String(cause) }),
  )()
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
  const diffs = fromLoro(() => doc.diff(from, to, false))

  if (diffs.isErr()) {
    return err(diffs.error)
  }

  for (const [container, diff] of diffs.value) {
    const found = fromLoro(() => doc.getPathToContainer(container))

    if (found.isErr()) {
      return err(found.error)
    }

    const path = found.value

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
 * its name and by the path to it, and accepted when the path leads into the records or when it
 * has no path (its record is gone, or the field it belongs to is not set).
 */
function foreignRoot(doc: LoroDoc, fork: LoroDoc): Result<string | undefined, BatchRejection> {
  const records = fork.getMap(RECORDS).id
  const changes = fromLoro(() => fork.exportJsonUpdates(doc.version(), fork.version()).changes)

  if (changes.isErr()) {
    return err(changes.error)
  }

  for (const change of changes.value) {
    for (const op of change.ops) {
      if (!op.container.startsWith('cid:root-') || op.container === records) {
        continue
      }

      if (!op.container.startsWith(MERGEABLE_ROOT)) {
        return ok(op.container)
      }

      const path = fromLoro(() => fork.getPathToContainer(op.container))

      if (path.isErr()) {
        return err(path.error)
      }

      if (path.value !== undefined && path.value[0] !== RECORDS) {
        return ok(op.container)
      }
    }
  }

  return ok(undefined)
}

/** The mergeable container a field of each kind holds; a field of any other kind holds a plain value. */
const MERGEABLE_KINDS = { text: 'Text', list: 'MovableList', counter: 'Counter' } as const

/** A record as the shape check reads it: its fields and what each holds. */
interface RecordFields {
  keys(): readonly unknown[]
  get(field: string): unknown
}

/**
 * The first field of a record whose shape the schema does not allow: a text, list or counter
 * field holds the mergeable container of its kind, every other field a plain value. A field of
 * another shape is refused whatever its content: a device writes a text, list or counter field
 * through its mergeable container and cannot once something else stands there, and a plain
 * field is written and projected as a value.
 */
function misshapenField(
  schema: ReplicaSchema,
  table: string,
  record: RecordFields,
): string | undefined {
  return record
    .keys()
    .map(String)
    .find((field) => {
      const value: unknown = record.get(field)
      const kind = fieldOf(schema, table, field)?.kind
      const mergeable =
        kind === 'text' || kind === 'list' || kind === 'counter' ? MERGEABLE_KINDS[kind] : undefined

      if (!isContainer(value)) {
        return mergeable !== undefined
      }

      return (
        mergeable === undefined ||
        value.kind() !== mergeable ||
        !value.id.startsWith(MERGEABLE_ROOT)
      )
    })
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
 * of the region and is a map whose fields have the shapes the schema gives them
 * (`invalid-record`, judged before anything else about the record). A record the batch leaves
 * as it was is then no change, whatever operations reached it: one it creates and deletes
 * again, or one it changes and changes back. This is what lets a device undo a refused edit or
 * delete: the batch that undoes it carries the refused change and its inverse. Such a batch
 * still reaches the document, so a plain field it set and set back wins a later
 * last-writer-wins conflict with a concurrent edit, as any accepted write does. Every other
 * record keeps the owner rule (`foreignOwner`): in a private region it references no identity
 * but the owner's, in a tenant region a new record names the pushing member and an existing
 * one keeps the members it named; and the member's ability allows the action on the record
 * (`forbidden-action`): a record is judged as it is, the one being changed or deleted as it
 * was, the new one as it is. An updated record keeps the fields the schema marks read-only
 * (`readonly-field`, judged after the owner rule): a device sets them when it creates a record
 * and never changes them after, while the server's own writes, which do not pass here, set
 * them freely.
 * The result is the plan the region's log accepts: the projection of each changed record, the
 * update bytes and the version after the batch. A refused batch is a value, never a throw
 * (bytes Loro throws on are `malformed`), and the authoritative document stays as it was
 * either way.
 */
export function validateBatch(input: ValidateBatchInput): Result<ValidatedBatch, BatchRejection> {
  const fork = input.doc.fork()
  const from = input.doc.frontiers()
  const status = fromLoro(() => fork.importBatch([...input.updates]))

  if (status.isErr()) {
    return err(status.error)
  }

  if (status.value.pending && status.value.pending.size > 0) {
    return err({
      reason: 'pending-dependencies',
      detail: 'the batch depends on changes the server does not have',
    })
  }

  const root = foreignRoot(input.doc, fork)

  if (root.isErr()) {
    return err(root.error)
  }

  if (root.value !== undefined) {
    return err(writesOutside(root.value))
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

    const misshapen = misshapenField(input.schema, split.table, record)

    if (misshapen !== undefined) {
      return err({ reason: 'invalid-record', detail: `${entry}.${misshapen}` })
    }

    const value = record.toJSON() as Record<string, unknown>

    // Changed and changed back, as a refused change and its inverse are: nothing to judge or write.
    if (prior !== undefined && sameValue(value, prior)) {
      continue
    }

    const action: Action = prior === undefined ? 'create' : 'update'

    // A record is judged as it is: the one being changed, or the new one being created.
    if (!input.ability.can(action, split.table, action === 'create' ? value : prior)) {
      return err(forbidden(entry, action))
    }

    const foreign = foreignOwner(input, split.table, value, prior)

    if (foreign) {
      return err({ reason: 'foreign-owner', detail: `${entry}.${foreign}` })
    }

    // An existing record keeps the fields devices may not change: the server alone sets them.
    const kept =
      prior === undefined
        ? undefined
        : readonlyFieldsOf(input.schema, split.table).find(
            (field) => !sameValue(value[field], prior[field]),
          )

    if (kept !== undefined) {
      return err({ reason: 'readonly-field', detail: `${entry}.${kept}` })
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
