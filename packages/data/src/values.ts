/**
 * Conversion between the values application code uses and the database
 * driver's own types. Above this package ids are entity id strings and times are
 * `Date`s; the driver's record ids and datetimes never leave the data layer.
 */

import { DateTime, RecordId } from 'surrealdb'

import type { ParamDecl } from './types'

const RECORD_TYPE = /^(?:option<)?record<([a-z_][a-z0-9_]*)>>?$/i

/** The table a declared parameter type points at: `record<t>` or `option<record<t>>`. */
export function recordTableOf(type: string): string | undefined {
  return RECORD_TYPE.exec(type.replace(/\s+/g, ''))?.[1]
}

export function recordId(table: string, key: string): RecordId {
  return new RecordId(table, key)
}

export interface RecordRef {
  readonly table: string
  readonly key: string
}

/** Splits a driver record id; any other value gives undefined. */
export function recordRef(value: unknown): RecordRef | undefined {
  // `instanceof` on a generic class narrows to its untyped form, so both parts are converted.
  return value instanceof RecordId
    ? { table: String(value.table.name), key: String(value.id) }
    : undefined
}

/** Prepares parameters for the driver: entity ids of record parameters become record ids. */
export function toDriverParams(
  params: unknown,
  decls: readonly ParamDecl[],
): Record<string, unknown> {
  const input = (params ?? {}) as Readonly<Record<string, unknown>>
  const output: Record<string, unknown> = { ...input }

  for (const decl of decls) {
    const table = recordTableOf(decl.type)
    const value = input[decl.name]

    if (table && typeof value === 'string') {
      output[decl.name] = recordId(table, value)
    }
  }

  return output
}

/** Converts a driver result into plain data: record ids to their keys, datetimes to dates. */
export function fromDriverValue(value: unknown): unknown {
  if (value instanceof RecordId) {
    return String(value.id)
  }

  if (value instanceof DateTime) {
    return value.toDate()
  }

  if (Array.isArray(value)) {
    return value.map(fromDriverValue)
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, fromDriverValue(inner)]),
    )
  }

  return value
}
