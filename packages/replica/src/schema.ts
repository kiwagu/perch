import type { Region } from '@workspace/data'
import type { TableAbilities } from '@workspace/kernel'

/** The kind of a field: what the replica stores and merges for it. */
type ReplicaFieldKind =
  | { readonly kind: 'text' }
  | { readonly kind: 'list' }
  | { readonly kind: 'counter' }
  | { readonly kind: 'record'; readonly table: string }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'plain' }

/**
 * What the replica knows about each field of a table: whether it is a mergeable CRDT
 * container, a reference to another record, a datetime, or a plain last-writer-wins value,
 * and whether devices may change it. A read-only field (`readonly`) is one a device sets when
 * it creates the record and never changes after: the gateway refuses a batch that changes it,
 * and only the server's own writes set it. The modeling stage derives this from the schema
 * annotations.
 */
export type ReplicaField = ReplicaFieldKind & { readonly readonly?: true }

/** A replicated table: the region whose document holds its records, each of its fields, and who may write it. */
export interface ReplicaTable extends TableAbilities {
  readonly region: Region
  readonly fields: Readonly<Record<string, ReplicaField>>
}

export type ReplicaSchema = Readonly<Record<string, ReplicaTable>>

/**
 * A field of a replicated table; undefined for a field the table does not have. Only the
 * schema's own entries count: a name every object inherits, such as `constructor`, is no field.
 */
export function fieldOf(
  schema: ReplicaSchema,
  table: string,
  field: string,
): ReplicaField | undefined {
  const fields = Object.hasOwn(schema, table) ? schema[table]?.fields : undefined

  return fields !== undefined && Object.hasOwn(fields, field) ? fields[field] : undefined
}

/** The fields of `table` a device may not change once the record exists, in the schema's order. */
export function readonlyFieldsOf(schema: ReplicaSchema, table: string): readonly string[] {
  const fields = Object.hasOwn(schema, table) ? schema[table]?.fields : undefined

  return fields === undefined
    ? []
    : Object.keys(fields).filter((field) => fields[field]?.readonly === true)
}

/** The replicated tables whose records live in documents of this region. */
export function tablesOf(schema: ReplicaSchema, region: Region): readonly string[] {
  return Object.keys(schema).filter((table) => schema[table]?.region === region)
}
