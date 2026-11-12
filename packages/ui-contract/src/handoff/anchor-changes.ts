/**
 * The anchors of the hand-over diff: the anchors one contract adds, removes or renames against
 * another, an anchor removed and one added being a rename when they are the only ones of their
 * screen and kind, and what each anchor both hold carries that one side adds or removes (its
 * derived parts, codes, states, roles, error fields and the like), a renamed one held by both
 * under its new name.
 */

import { type Contract, declaredAnchors } from '../check'
import type { AnchorDef } from '../files'

import { byName, type Change, changeOf } from './change'

/** Each anchor with the screen it is declared in and its kind. */
const anchorsOf = (contract: Contract | undefined): Map<string, string> =>
  new Map(
    contract === undefined
      ? []
      : declaredAnchors(contract.screens).map(({ anchor, def, screen }) => [
          anchor,
          `${screen.id} ${def.kind}`,
        ]),
  )

/** The names by the screen and kind `place` gives each of them. */
function groupOf(names: readonly string[], place: ReadonlyMap<string, string>) {
  const groups = new Map<string, string[]>()

  for (const name of names) {
    const group = place.get(name) ?? ''

    groups.set(group, [...(groups.get(group) ?? []), name])
  }

  return groups
}

/**
 * The anchors removed and added, with a rename wherever a screen and kind lost exactly one
 * anchor and gained exactly one: with more on either side the pairing would be a guess, so
 * they stay removed and added.
 */
export function anchorChanges(before: Contract | undefined, after: Contract | undefined) {
  const was = anchorsOf(before)
  const is = anchorsOf(after)
  const { added, removed } = changeOf([...was.keys()], [...is.keys()])
  const gained = groupOf(added, is)
  const renamed: Array<{ from: string; to: string }> = []

  for (const [group, lost] of groupOf(removed, was)) {
    const [from] = lost
    const [to, ...more] = gained.get(group) ?? []

    if (from !== undefined && to !== undefined && lost.length === 1 && more.length === 0) {
      renamed.push({ from, to })
    }
  }

  const paired = new Set(renamed.flatMap(({ from, to }) => [from, to]))

  return {
    added: added.filter((name) => !paired.has(name)),
    removed: removed.filter((name) => !paired.has(name)),
    renamed: renamed.sort((a, b) => byName(a.from, b.from)),
  }
}

/** Each anchor's definition, by its name. */
const defsOf = (contract: Contract | undefined): Map<string, AnchorDef> =>
  new Map(
    contract === undefined
      ? []
      : declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]),
  )

/**
 * What `entriesOf` lists of each anchor both contracts hold, as `<anchor> <entry>` (or with
 * another separator), added and removed; an anchor renamed is held by both under its new name.
 */
export function carriedChanges(
  before: Contract | undefined,
  after: Contract | undefined,
  renamed: ReadonlyArray<{ from: string; to: string }>,
  entriesOf: (def: AnchorDef) => readonly string[],
  separator = ' ',
): Change {
  const to = new Map(renamed.map(({ from, to: name }) => [from, name]))
  const was = new Map([...defsOf(before)].map(([anchor, def]) => [to.get(anchor) ?? anchor, def]))
  const is = defsOf(after)
  const listed = (defs: Map<string, AnchorDef>, other: Map<string, AnchorDef>) =>
    [...defs].flatMap(([anchor, def]) =>
      other.has(anchor) ? entriesOf(def).map((entry) => `${anchor}${separator}${entry}`) : [],
    )

  return changeOf(listed(was, is), listed(is, was))
}
