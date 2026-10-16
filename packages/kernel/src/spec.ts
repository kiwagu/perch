import { match } from 'ts-pattern'

export type Scalar = string | number | boolean | null

/** A read-side condition, evaluated in memory against a plain record. */
export type QuerySpec =
  | { readonly kind: 'eq'; readonly field: string; readonly value: Scalar }
  | { readonly kind: 'and'; readonly specs: readonly QuerySpec[] }
  | { readonly kind: 'or'; readonly specs: readonly QuerySpec[] }
  | { readonly kind: 'not'; readonly spec: QuerySpec }

export function isSatisfiedBy(spec: QuerySpec, record: Readonly<Record<string, unknown>>): boolean {
  return match(spec)
    .with({ kind: 'eq' }, ({ field, value }) => record[field] === value)
    .with({ kind: 'and' }, ({ specs }) => specs.every((part) => isSatisfiedBy(part, record)))
    .with({ kind: 'or' }, ({ specs }) => specs.some((part) => isSatisfiedBy(part, record)))
    .with({ kind: 'not' }, ({ spec: inner }) => !isSatisfiedBy(inner, record))
    .exhaustive()
}

/** Where a written value comes from: a command parameter, a literal, or the clock. */
export type ValueRef =
  | { readonly param: string }
  | { readonly literal: unknown }
  | { readonly now: true }

/**
 * One step of a write, as plain data. A command declared in SurrealQL compiles
 * into a list of these; a write path interprets them against its storage.
 * `record` names the parameter that holds the record id.
 */
export type ChangeSpec =
  | {
      readonly op: 'create'
      readonly record: string
      readonly fields: Readonly<Record<string, ValueRef>>
    }
  | {
      readonly op: 'set'
      readonly record: string
      readonly field: string
      readonly value: ValueRef
    }
  | { readonly op: 'unset'; readonly record: string; readonly field: string }
  | {
      readonly op: 'text.update'
      readonly record: string
      readonly field: string
      readonly value: ValueRef
    }
  | {
      readonly op: 'list.push'
      readonly record: string
      readonly field: string
      readonly value: ValueRef
    }
  | {
      readonly op: 'list.remove'
      readonly record: string
      readonly field: string
      readonly value: ValueRef
    }
  | { readonly op: 'delete'; readonly record: string }

export function resolveValue(
  ref: ValueRef,
  params: Readonly<Record<string, unknown>>,
  now: () => Date,
): unknown {
  if ('param' in ref) {
    return params[ref.param]
  }

  if ('literal' in ref) {
    return ref.literal
  }

  return now()
}
