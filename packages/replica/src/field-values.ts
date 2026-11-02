import type { LoroMap } from 'loro-crdt'

import { fieldOf, type ReplicaSchema } from './schema'

/**
 * A field's value as a record of `table` holds it in a region document: a reference to
 * another record as `table:key` (a bare key gets the referenced table), a time as an ISO
 * string, anything else as it is.
 */
export function documentValue(
  schema: ReplicaSchema,
  table: string,
  field: string,
  value: unknown,
): unknown {
  const kind = fieldOf(schema, table, field)

  if (kind?.kind === 'record' && typeof value === 'string' && !value.includes(':')) {
    return `${kind.table}:${value}`
  }

  return value instanceof Date ? value.toISOString() : value
}

/**
 * Writes one field of a record of `table`: a text field through its mergeable text, replaced
 * whole, so concurrent edits of the text merge; an undefined value removes the field; any other
 * value is set as the document holds it, and the last writer wins.
 */
export function writeField(
  schema: ReplicaSchema,
  table: string,
  record: LoroMap,
  field: string,
  value: unknown,
): void {
  if (fieldOf(schema, table, field)?.kind === 'text') {
    record.ensureMergeableText(field).update(String(value ?? ''))

    return
  }

  if (value === undefined) {
    record.delete(field)

    return
  }

  record.set(field, documentValue(schema, table, field, value) as never)
}
