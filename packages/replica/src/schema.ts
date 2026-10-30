import type { Region } from '@workspace/data'
import type { TableAbilities } from '@workspace/kernel'

/**
 * What the replica needs to know about a table's fields beyond plain values:
 * which fields are mergeable CRDT containers, which hold references to other
 * records, and which hold datetimes. Fields not listed are last-writer-wins values.
 * The modeling stage derives this from the schema annotations.
 */
export type ReplicaField =
  | { readonly kind: 'text' }
  | { readonly kind: 'list' }
  | { readonly kind: 'counter' }
  | { readonly kind: 'record'; readonly table: string }
  | { readonly kind: 'datetime' }

/** A replicated table: the region whose document holds its records, its non-plain fields, and who may write it. */
export interface ReplicaTable extends TableAbilities {
  readonly region: Region
  readonly fields: Readonly<Record<string, ReplicaField>>
}

export type ReplicaSchema = Readonly<Record<string, ReplicaTable>>

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
