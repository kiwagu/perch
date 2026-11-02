import { type LoroDoc, LoroMap } from 'loro-crdt'
import { err, ok, Result } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { messageOf } from '../failure'
import { documentValue, writeField } from '../field-values'
import { recordKey } from '../keys'
import { toColumns } from '../projection-values'
import type { RegionRef } from '../region-doc'
import { fieldOf, type ReplicaSchema, tablesOf } from '../schema'

import type { AcceptPlan } from './region-log'
import { SERVER_PEER } from './server-peer'

/** A value the server sets a field to. */
export type FieldValue = string | number | boolean | Date

/** A change of the server's own to one record of a region: the fields it sets on the record. */
export interface RecordWrite {
  /** The record's table, a replicated table of the region's kind. */
  readonly table: string
  /** The record's id within its table (`prf_…`); the region holds the record already. */
  readonly id: string
  /**
   * The fields to set, each a field of the table, and their values: a plain field takes the
   * value as it is, a datetime a `Date` (or its ISO string), a reference the id of the record
   * it references (or `table:id`), a text field its whole text.
   */
  readonly set: Readonly<Record<string, FieldValue>>
}

export interface PlanRecordWriteInput {
  /** The authoritative document of the region; planning never modifies it. */
  readonly doc: LoroDoc
  readonly region: RegionRef
  readonly schema: ReplicaSchema
  readonly write: RecordWrite
}

const refused = (message: string): Result<never, DataError> =>
  err(dataError('data:WRITE_REJECTED', message))

/**
 * Why a field of the write cannot be set, or undefined when it can. A date that names no time
 * has no ISO form to store. A list or a counter changes only through its own operations. In a
 * private region every identity reference names the region's owner, the rule a device's batch
 * is held to as well, so the owner's devices can still edit the record afterwards.
 */
function unsettable(
  { region, schema, write }: PlanRecordWriteInput,
  field: string,
  value: FieldValue,
): string | undefined {
  const kind = fieldOf(schema, write.table, field)

  if (!kind) {
    return `${field} is not a field of ${write.table}`
  }

  if (value instanceof Date && Number.isNaN(value.getTime())) {
    return `${write.table}.${field} is set to a date that names no time`
  }

  if (kind.kind === 'list' || kind.kind === 'counter') {
    return `${write.table}.${field} is a ${kind.kind}, which only its own operations change`
  }

  const foreign =
    region.kind === 'private' &&
    kind.kind === 'record' &&
    kind.table === 'identity' &&
    documentValue(schema, write.table, field, value) !== region.id

  return foreign ? `${write.table}.${field} names another identity than ${region.id}` : undefined
}

/**
 * Builds a change of the server's own to one record of a region, as the log accepts it: the
 * fields are set on a fork of the region's document that writes as the server's peer, and the
 * plan holds the record's projection, the update bytes and the version after the change. The
 * write is checked against the replica schema first: the table belongs to the region's kind,
 * the region holds the record, and each field is one of its table's that a value can set.
 * A refused write is a `data:WRITE_REJECTED` and changes nothing. A write that sets every field
 * to the value it holds already makes no change, and its plan is undefined.
 */
export function planRecordWrite(
  input: PlanRecordWriteInput,
): Result<AcceptPlan | undefined, DataError> {
  const { doc, region, schema, write } = input
  const entry = recordKey(write.table, write.id)

  if (!tablesOf(schema, region.kind).includes(write.table)) {
    return refused(`${write.table} is not a table of ${region.kind} regions`)
  }

  for (const [field, value] of Object.entries(write.set)) {
    const why = unsettable(input, field, value)

    if (why !== undefined) {
      return refused(why)
    }
  }

  const fork = doc.fork()

  fork.setPeerId(SERVER_PEER)

  const found: unknown = fork.getMap('records').get(entry)

  if (!(found instanceof LoroMap)) {
    return refused(`${entry} is not a record of ${region.id}`)
  }

  const record = found as LoroMap
  // A value the document cannot hold refuses the write, as a value, like any other refusal.
  const written = Result.fromThrowable(
    () => {
      for (const [field, value] of Object.entries(write.set)) {
        writeField(schema, write.table, record, field, value)
      }

      fork.commit()
    },
    (cause) =>
      dataError(
        'data:WRITE_REJECTED',
        `${entry} cannot take the values: ${messageOf(cause)}`,
        cause,
      ),
  )()

  if (written.isErr()) {
    return err(written.error)
  }

  // Loro makes no operation of a value a field holds already.
  if (fork.version().compare(doc.version()) === 0) {
    return ok(undefined)
  }

  return ok({
    upserts: [
      {
        table: write.table,
        key: write.id,
        entry,
        data: toColumns(schema, write.table, record.toJSON() as Record<string, unknown>),
      },
    ],
    deletes: [],
    bytes: fork.export({ mode: 'update', from: doc.version() }),
    version: fork.version().encode(),
  })
}
