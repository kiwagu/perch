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

export type ReplicaSchema = Readonly<Record<string, Readonly<Record<string, ReplicaField>>>>

export function fieldOf(
  schema: ReplicaSchema,
  table: string,
  field: string,
): ReplicaField | undefined {
  return schema[table]?.[field]
}
