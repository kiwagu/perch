/**
 * When each element shows, for the hand-over: the entries of its `with` and `without` that one
 * contract adds or removes against another, as `<anchor> with <entry>` and `<anchor> without
 * <entry>`, the entry being the anchor it names, with `: <code> or <code>` when it names codes
 * (the codes as a set, sorted); and, for an entry both hold, its codes when they change, as
 * `<anchor> with <entry> codes <before> -> <after>`, `none` on the side that names none. The
 * entries of an element in a list's entry name anchors of the same entry, so the line says no
 * more of it. An anchor added or removed whole lists every entry, which nothing else in the
 * summary says; one renamed holds its entries, and one named by an entry is compared under its
 * new name. The entries are those of the loaded contract.
 */

import { entryAnchorOf, entryCodesOf } from '../anchors'
import { type Contract, declaredAnchors } from '../check'

import { byName, type Change, changeOf } from './change'

/**
 * The entries added and removed as `<anchor> with|without <entry>[: <codes>]`, and the codes
 * changed of each entry both hold as `<anchor> with|without <entry> codes <before> -> <after>`.
 */
export type VisibilityChanges = Change & { changed: string[] }

type Renamed = ReadonlyArray<{ from: string; to: string }>

const LISTS = ['with', 'without'] as const

/**
 * The entries of every anchor of `contract`, by `<anchor> with|without <entry anchor>`, each with
 * the codes it names as words (undefined for an anchor entry), an anchor renamed under its new
 * name; none for a contract left undefined.
 */
function entriesOf(
  contract: Contract | undefined,
  renamed: Renamed,
): Map<string, string | undefined> {
  const to = new Map(renamed.map(({ from, to: name }) => [from, name]))
  const nameOf = (anchor: string): string => to.get(anchor) ?? anchor

  return new Map(
    contract === undefined
      ? []
      : declaredAnchors(contract.screens).flatMap(({ anchor, def }) =>
          LISTS.flatMap((list) =>
            (def[list] ?? []).map((entry) => {
              const codes = entryCodesOf(entry)

              return [
                `${nameOf(anchor)} ${list} ${nameOf(entryAnchorOf(entry))}`,
                codes === undefined ? undefined : [...codes].sort(byName).join(' or '),
              ] as const
            }),
          ),
        ),
  )
}

/** An entry as a line: its key, then `: <codes>` when it names codes. */
const lineOf = (key: string, codes: string | undefined): string =>
  codes === undefined ? key : `${key}: ${codes}`

export function visibilityChanges(
  before: Contract | undefined,
  after: Contract | undefined,
  renamed: Renamed,
): VisibilityChanges {
  const was = entriesOf(before, renamed)
  const is = entriesOf(after, [])
  const { added, removed } = changeOf([...was.keys()], [...is.keys()])
  const changed = [...is].flatMap(([key, codes]) =>
    was.has(key) && was.get(key) !== codes
      ? [`${key} codes ${was.get(key) ?? 'none'} -> ${codes ?? 'none'}`]
      : [],
  )

  return {
    added: added.map((key) => lineOf(key, is.get(key))),
    removed: removed.map((key) => lineOf(key, was.get(key))),
    changed: changed.sort(byName),
  }
}
