import type { Region } from '@workspace/data'
import type { TableAbilities } from '@workspace/kernel'

/**
 * What the replica knows about each field of a table: whether it is a mergeable CRDT
 * container, a reference to another record, a datetime, or a plain last-writer-wins value.
 * The modeling stage derives this from the schema annotations.
 */
export type ReplicaField =
  | { readonly kind: 'text' }
  | { readonly kind: 'list' }
  | { readonly kind: 'counter' }
  | { readonly kind: 'record'; readonly table: string }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'plain' }

/** A replicated table: the region whose document holds its records, each of its fields, and who may write it. */
export interface ReplicaTable extends TableAbilities {
  readonly region: Region
  readonly fields: Readonly<Record<string, ReplicaField>>
}

export type ReplicaSchema = Readonly<Record<string, ReplicaTable>>

/** A field of a replicated table; undefined for a field the table does not have. */
export function fieldOf(
  schema: ReplicaSchema,
  table: string,
  field: string,
): ReplicaField | undefined {
  return schema[table]?.fields[field]
}

/** The replicated tables whose records live in documents of this region. */
export function tablesOf(schema: ReplicaSchema, region: Region): readonly string[] {
  return Object.keys(schema).filter((table) => schema[table]?.region === region)
}
