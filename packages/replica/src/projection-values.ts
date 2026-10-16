import { recordId } from '@workspace/data'

import { fieldOf, type ReplicaSchema } from './schema'

/** References stored as `table:key` become record ids, ISO strings of datetime fields become dates. */
function toColumn(schema: ReplicaSchema, table: string, field: string, value: unknown): unknown {
  const kind = fieldOf(schema, table, field)

  if (kind?.kind === 'record' && typeof value === 'string') {
    const colon = value.indexOf(':')

    return recordId(value.slice(0, colon), value.slice(colon + 1))
  }

  if (kind?.kind === 'datetime' && typeof value === 'string') {
    return new Date(value)
  }

  return value
}

/** The column values of a record as a region document holds it, ready to be written into its table. */
export function toColumns(
  schema: ReplicaSchema,
  table: string,
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => [field, toColumn(schema, table, field, value)]),
  )
}
