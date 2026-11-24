/**
 * `with` and `without`: an element renders only while each of its `with` entries renders and none
 * of its `without` entries does. An entry names an anchor of the element's own screen (the
 * frame's, on the frame), and a code entry's codes are among those that anchor carries, as loaded
 * (the codes the loader derives included). An element names neither itself, nor one anchor twice
 * (in one list, or in both), nor an anchor that names it back, directly or through others: a cycle
 * is said on one of its anchors. An anchor rendered in each entry of a list (`entryOf`) names
 * anchors of the same entry. See the rule `with-without`.
 */

import { entryAnchorOf, entryCodesOf, entryOf, type WithEntry } from '../anchors'
import type { AnchorDef, Problem, Screen } from '../files'

import { type Contract, declaredAnchors, type InScreens, locate } from './contract'

const LISTS = ['with', 'without'] as const

/** The anchors an element's entries name, `with` then `without`, each once. */
const namedBy = (def: AnchorDef): string[] => [
  ...new Set([...(def.with ?? []), ...(def.without ?? [])].map(entryAnchorOf)),
]

/**
 * The anchors from `from` to `to` through the entries of `screen`, the shortest way, `to` last;
 * undefined when `to` cannot be reached. An anchor's own name in its entries leads nowhere.
 */
function pathOf(screen: Screen, from: string, to: string): string[] | undefined {
  const seen = new Set([from])

  for (let ways = [[from]]; ways.length > 0; ) {
    const next: string[][] = []

    for (const way of ways) {
      const last = way.at(-1) ?? from
      const def = Object.hasOwn(screen.anchors, last) ? screen.anchors[last] : undefined

      for (const named of def === undefined ? [] : namedBy(def)) {
        if (named === to) {
          return [...way, to]
        }
        if (!seen.has(named) && named !== last) {
          seen.add(named)
          next.push([...way, named])
        }
      }
    }
    ways = next
  }

  return undefined
}

/** The cycle an element's entry closes, when the anchor it names names it back. */
function cycleOf(screen: Screen, anchor: string, other: string): string | undefined {
  const path = pathOf(screen, other, anchor)

  if (path === undefined) {
    return undefined
  }

  const through = path.slice(1, -1).map((each) => `"${each}"`)

  return `"${other}" names "${anchor}" back${through.length === 0 ? '' : ` through ${through.join(', ')}`}, a cycle: say it on one of them`
}

/**
 * The problems of one entry of `anchor`: itself, an anchor of no screen or another one, or one
 * outside its entry stops the rest; else its codes, a name `before` it in its list or in `with`
 * (`inWith`, for an entry of `without`), and a cycle.
 */
function entryProblems(
  screen: Screen,
  screenOf: ReadonlyMap<string, string>,
  anchor: string,
  entry: WithEntry,
  named: { readonly before: readonly string[]; readonly inWith: readonly string[] },
): string[] {
  const other = entryAnchorOf(entry)
  const target = Object.hasOwn(screen.anchors, other) ? screen.anchors[other] : undefined

  if (other === anchor) {
    return [`"${anchor}" names itself`]
  }
  if (target === undefined) {
    const elsewhere = screenOf.get(other)

    return [
      elsewhere === undefined
        ? `"${other}" is no anchor of ${screen.id}`
        : `"${other}" is an anchor of ${elsewhere}: an entry names an anchor of ${screen.id}`,
    ]
  }

  const scope = entryOf(anchor, screen.anchors)

  if (scope !== undefined && entryOf(other, screen.anchors) !== scope) {
    return [
      `"${other}" is outside the entry of "${scope}": an anchor of an entry names anchors of the same entry`,
    ]
  }

  const cycle = cycleOf(screen, anchor, other)

  return [
    ...(entryCodesOf(entry) ?? [])
      .filter((code) => !(target.codes ?? []).includes(code))
      .map((code) => `"${other}" carries no code "${code}"`),
    ...(named.before.includes(other) ? [`"${other}" is named twice`] : []),
    ...(named.inWith.includes(other) ? [`"${other}" is in both with and without`] : []),
    ...(cycle === undefined ? [] : [cycle]),
  ]
}

/** The problems of the entries of one element of `screen`, declared at `at`. */
function elementProblems(
  inScreens: InScreens,
  screen: Screen,
  screenOf: ReadonlyMap<string, string>,
  anchor: string,
  def: AnchorDef,
  at: readonly PropertyKey[],
): Problem[] {
  return LISTS.flatMap((key) => {
    const entries = def[key] ?? []
    const inWith = key === 'without' ? (def.with ?? []).map(entryAnchorOf) : []

    return entries.flatMap((entry, index) =>
      entryProblems(screen, screenOf, anchor, entry, {
        before: entries.slice(0, index).map(entryAnchorOf),
        inWith,
      }).map((message) => inScreens([...at, key, index], message)),
    )
  })
}

/** Every entry of every element's `with` and `without`, held as the header says. */
export function withProblems({ screens }: Contract): Problem[] {
  const inScreens = locate(screens)
  const declared = declaredAnchors(screens)
  const screenOf = new Map(declared.map(({ anchor, screen }) => [anchor, screen.id]))

  return declared.flatMap(({ anchor, def, screen, at }) =>
    elementProblems(inScreens, screen, screenOf, anchor, def, at),
  )
}
