/**
 * The three contract files as the check reads them, and the lookups its rules share: the
 * declared anchors, a known anchor (declared, or a declared base with a suffix it lists in
 * `derived`), the states and choice values of the vocabulary, and a problem located in
 * `screens.json`.
 */

import { baseOf } from '../anchors'
import {
  type AnchorDef,
  type Model,
  type Problem,
  SCREENS_FILE,
  type Screen,
  type ScreensFile,
  type Vocabulary,
} from '../files'
import { jsonPath } from '../files/problems'

export interface Contract {
  readonly vocabulary: Vocabulary
  readonly screens: ScreensFile
  readonly model: Model
}

export interface DeclaredAnchor {
  readonly anchor: string
  readonly def: AnchorDef
  readonly screen: Screen
  /** Where the anchor is declared: `screens[i].anchors["<anchor>"]`. */
  readonly at: readonly PropertyKey[]
}

export const declaredAnchors = (screens: ScreensFile): DeclaredAnchor[] =>
  screens.screens.flatMap((screen, index) =>
    Object.entries(screen.anchors).map(([anchor, def]) => ({
      anchor,
      def,
      screen,
      at: ['screens', index, 'anchors', anchor],
    })),
  )

/** Whether `record` has `key` as its own key (never a name of the object prototype). */
export const has = (record: object, key: string): boolean => Object.hasOwn(record, key)

/** The own entry `key` of `record`, if any. */
export const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/** A problem of `screens.json` at a JSON path: `screens[0].anchors["x"].kind: ...`. */
export const inScreens = (path: readonly PropertyKey[], message: string): Problem => ({
  file: SCREENS_FILE,
  message: `${jsonPath(path)}: ${message}`,
})

/**
 * Whether an anchor is declared, or derived from a declared base with a suffix that base
 * lists in `derived`: a suffix of the vocabulary alone names no element the base renders.
 */
export function knownAnchors(contract: Contract): (anchor: string) => boolean {
  const defs = new Map(declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]))
  const suffixes = Object.keys(contract.vocabulary.suffixes)

  return (anchor) => {
    if (defs.has(anchor)) {
      return true
    }

    const base = baseOf(anchor, suffixes)
    const derived = base === undefined ? undefined : defs.get(base)?.derived

    return base !== undefined && (derived ?? []).includes(anchor.slice(base.length + 1))
  }
}

/** Every state of the vocabulary: app, container and row states. */
export const statesOf = (vocabulary: Vocabulary): Set<string> =>
  new Set([
    ...Object.keys(vocabulary.appStates),
    ...Object.keys(vocabulary.containerStates),
    ...Object.keys(vocabulary.rowStates),
  ])

/** A choice value written as a pattern (`^[a-z]+$`) stands for every value it matches. */
export const isPattern = (value: string): boolean => value.startsWith('^')

const matches = (pattern: string, value: string): boolean => {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

/** Whether `value` is a row of some anchor's choice values, or matches a pattern row. */
export const isChoiceValue = (vocabulary: Vocabulary, value: string): boolean =>
  Object.values(vocabulary.choiceValues).some((rows) =>
    Object.keys(rows).some((row) => row === value || (isPattern(row) && matches(row, value))),
  )

/** The paths of every binding of every screen. */
export const bindingPaths = (screens: ScreensFile): Set<string> =>
  new Set(screens.screens.flatMap((screen) => screen.bindings.map(({ path }) => path)))
