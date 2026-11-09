/**
 * An entry named as a value: an `item` or a `row` whose `data-id` an action's parameter or a
 * navigate's search takes, the id of the entry whose control the user acted on. The entry is
 * declared on the screen that names it, carries a `dataId`, and belongs to a list, a table or a
 * section of that screen (`containersOf`); the control that gives its id is in the entry's part
 * (`<part>.<name>`, like the entry: `inPartOf`), rendered in each entry, so it acts on the entry
 * it is in, and never the entry itself, which is no control.
 */

import { containersOf, ENTRY_KINDS, inPartOf, partOf } from '../anchors'
import type { AnchorDef, Problem, Screen } from '../files'

import { type InScreens, own } from './contract'

/** What the checks of an entry read: its screen, every declared anchor, and where to report. */
export interface EntryLookups {
  readonly screen: Screen
  readonly defs: ReadonlyMap<string, AnchorDef>
  readonly inScreens: InScreens
}

/** Who takes the entry's data-id, as the problems name it. */
export type EntryUse = 'a search' | 'a parameter'

/** What carries the data-id: the event of a control in the entry's part. */
const CARRIED = 'only the event of a control in its entries carries it'

/** Whether `item` names an entry of any screen: a declared `item` or `row`. */
export const isEntry = ({ defs }: Pick<EntryLookups, 'defs'>, item: string): boolean =>
  ENTRY_KINDS.has(defs.get(item)?.kind ?? '')

/** The problems of `item` named as the entry whose data-id `use` takes, at `at`. */
export function entryProblems(
  { screen, defs, inScreens }: EntryLookups,
  item: string,
  use: EntryUse,
  at: readonly PropertyKey[],
): Problem[] {
  const def = own(screen.anchors, item)

  if (def === undefined) {
    return defs.has(item)
      ? [
          inScreens(
            at,
            `"${item}" is an anchor of another screen: ${use} takes the data-id of an entry of its own screen`,
          ),
        ]
      : [inScreens(at, `"${item}" is not a declared anchor of the screen`)]
  }

  if (!ENTRY_KINDS.has(def.kind)) {
    return [
      inScreens(
        at,
        `"${item}" is a ${def.kind}, not an item or a row: ${use} takes the data-id of an entry`,
      ),
    ]
  }

  return [
    ...(def.dataId === undefined
      ? [
          inScreens(
            at,
            `"${item}" declares no dataId: ${use} takes the data-id of an entry, which its dataId says`,
          ),
        ]
      : []),
    ...(containersOf(item, screen.anchors).length === 0
      ? [
          inScreens(
            at,
            `"${item}" is an entry of no list, table or section of the screen: an entry is declared under its container or beside it in its part`,
          ),
        ]
      : []),
  ]
}

/** Whether `event` is an anchor of `screen`: declared on it, or a part derived from one. */
const isOwnAnchor = (screen: Screen, event: string): boolean =>
  Object.keys(screen.anchors).some((anchor) => event === anchor || event.startsWith(`${anchor}.`))

/**
 * Why `event` cannot give the data-id of `item`, or undefined when it can: it is the entry
 * itself, no control of the screen (a platform or data event, another screen's anchor), or a
 * control outside the entry's part. `on` says where the event is (`on "<event>"`).
 */
export function carrierProblem(
  screen: Screen,
  item: string,
  event: string,
  on: (what: string) => string,
): string | undefined {
  const takes = `takes the data-id of "${item}"`

  if (event === item) {
    return `${takes} ${on('the entry itself')}, which is no control: a control in it (a link) carries it`
  }

  if (!isOwnAnchor(screen, event)) {
    return `${takes} ${on(`"${event}"`)}, which is no control of the screen: ${CARRIED}`
  }

  return inPartOf(item, event)
    ? undefined
    : `${takes} ${on(`"${event}"`)}, which is not in its part "${partOf(item)}": only a control in the item's part, rendered in each entry, carries it`
}

/** The problem of `item`'s data-id taken where no entry was acted on: `where` says where. */
export const unactedProblem = (item: string, where: string): string =>
  `takes the data-id of "${item}" ${where}, where no entry was acted on: ${CARRIED}`
