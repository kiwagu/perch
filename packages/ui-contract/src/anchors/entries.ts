/**
 * The entries of a list: an `item` or a `row` marks every entry of its list, table or section,
 * which `data-id` tells apart. The container an entry belongs to is a list, a table or a section
 * of its screen that it is declared under (`device.list.session-item` under `device.list`), the
 * nearest first, then one declared beside it in its part (`organisation.notes.item` beside
 * `organisation.notes.list`). A control in the entry's part (`<part>.<name>`, like the entry) is
 * rendered in each entry and acts on the entry it is in, whose `data-id` it gives.
 */

import { isUnder, LISTING_KINDS, partOf } from './grammar'

/** The kinds that mark every entry of their container, each with its `data-id`. */
export const ENTRY_KINDS: ReadonlySet<string> = new Set(['item', 'row'])

/** The lists, tables and sections `entry` belongs to among `anchors`, as the header says. */
export function containersOf(
  entry: string,
  anchors: Readonly<Record<string, { readonly kind: string }>>,
): string[] {
  const listing = Object.entries(anchors).flatMap(([anchor, { kind }]) =>
    LISTING_KINDS.has(kind) && anchor !== entry ? [anchor] : [],
  )
  const above = listing
    .filter((anchor) => isUnder(anchor, entry))
    .sort((one, other) => other.length - one.length)
  const beside = listing.filter((anchor) => partOf(anchor) === partOf(entry))

  return [...above, ...beside]
}

/** Whether `control` is in the part of `entry` (`<part>.<name>`), and not the entry itself. */
export const inPartOf = (entry: string, control: string): boolean =>
  control !== entry && partOf(control) === partOf(entry)
