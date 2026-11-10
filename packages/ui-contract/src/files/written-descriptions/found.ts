/**
 * A description found in the data of a domain file, before the reader names the file: its JSON
 * path in the file, the kind of field it is, its place and its text. The place names it the same
 * at any ref (`app-shell.theme-select`, `user.profile flow editing.save`), so the diff pairs the
 * two sides by it; it is told by what holds it, never by the depth of its path.
 */

import { entriesOf, recordOf } from '../../records'
import type { DescriptionKind } from '../../schemas'

export interface Found {
  readonly at: readonly PropertyKey[]
  readonly kind: DescriptionKind
  readonly place: string
  readonly text: string
}

/** Whether a value read from a file is a list. */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value)

/** The `description` the record at `at` writes, if it writes one. */
export function describedAt(
  value: unknown,
  at: readonly PropertyKey[],
  kind: DescriptionKind,
  place: string,
): Found[] {
  const text = recordOf(value)['description']

  return typeof text === 'string' ? [{ at: [...at, 'description'], kind, place, text }] : []
}

/**
 * The descriptions of one transition, or of a guarded list of them, each of a list of more than
 * one at its position, `<place> #<n>`; a transition written as its target alone has none.
 */
export function transitionsAt(
  value: unknown,
  at: readonly PropertyKey[],
  kind: DescriptionKind,
  place: string,
): Found[] {
  if (!isList(value)) {
    return describedAt(value, at, kind, place)
  }

  return value.flatMap((each, index) =>
    describedAt(each, [...at, index], kind, value.length > 1 ? `${place} #${index + 1}` : place),
  )
}

/** The meanings a map of names writes, each a sentence of its own; an entry of another shape has none. */
export function meaningsAt(
  value: unknown,
  at: readonly PropertyKey[],
  kind: DescriptionKind,
  placeOf: (name: string) => string,
): Found[] {
  return entriesOf(value).flatMap(([name, text]) =>
    typeof text === 'string' ? [{ at: [...at, name], kind, place: placeOf(name), text }] : [],
  )
}

/** The name a file gives itself under `key`, which names its places; a file without it is refused. */
export function nameOf(value: unknown, key: string, file: string): string {
  const name = recordOf(value)[key]

  if (typeof name !== 'string') {
    throw new Error(`${file} names no ${key}`)
  }

  return name
}
