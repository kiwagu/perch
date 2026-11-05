/**
 * The descriptions of a change, for its hand-over: every description the files write that one
 * contract adds, removes or changes against the other, by its place, with its length on each
 * side, a shrink included, so a change of prose shows even where nothing that runs changed. Both
 * sides are read as the budget reads them (`contract.descriptions`), the contract at a git ref
 * as its files write them there.
 */

import type { Contract } from '../check'
import { descriptionLength } from '../schemas'

import { byName } from './change'

export interface DescriptionChange {
  /** Where the description stands, the same at any ref: `app-shell.theme-select`. */
  readonly place: string
  /** Its length in characters on the side changed from; none for a description added. */
  readonly before?: number
  /** Its length in characters on the side changed to; none for a description removed. */
  readonly after?: number
}

/** Each written description by its place; an anchor renamed under its new name. */
const textsOf = (
  contract: Contract | undefined,
  renamedTo: ReadonlyMap<string, string>,
): Map<string, string> =>
  new Map(
    (contract?.descriptions ?? []).map(({ kind, place, text }) => [
      kind === 'anchor' ? (renamedTo.get(place) ?? place) : place,
      text,
    ]),
  )

/**
 * The descriptions `after` adds, removes or changes against `before`, sorted by place; the
 * description of an anchor `renamed` is held by both sides under its new name.
 */
export function descriptionChanges(
  before: Contract | undefined,
  after: Contract | undefined,
  renamed: ReadonlyArray<{ from: string; to: string }>,
): DescriptionChange[] {
  const was = textsOf(before, new Map(renamed.map(({ from, to }) => [from, to])))
  const is = textsOf(after, new Map())

  return [...new Set([...was.keys(), ...is.keys()])].sort(byName).flatMap((place) => {
    const old = was.get(place)
    const now = is.get(place)

    return old === now
      ? []
      : [
          {
            place,
            ...(old === undefined ? {} : { before: descriptionLength(old) }),
            ...(now === undefined ? {} : { after: descriptionLength(now) }),
          },
        ]
  })
}
