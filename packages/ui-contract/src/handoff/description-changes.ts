/**
 * The descriptions of a change, for its hand-over: every description the files write that one
 * contract adds, removes or changes against the other, by its place, with its length on each
 * side, a shrink included, so a change of prose shows even where nothing that runs changed. Both
 * sides are read as the budget reads them (`contract.descriptions`), the contract at a git ref
 * as its files write them there.
 */

import type { Contract } from '../check'
import { type DescriptionKind, descriptionLength } from '../schemas'

import { byName } from './change'

export interface DescriptionChange {
  /** Where the description stands, the same at any ref: `app-shell.theme-select`. */
  readonly place: string
  /** Its length in characters on the side changed from; none for a description added. */
  readonly before?: number
  /** Its length in characters on the side changed to; none for a description removed. */
  readonly after?: number
}

/** A written description as the diff pairs it: its kind and place, the same at any ref. */
interface Paired {
  readonly kind: DescriptionKind
  readonly place: string
  readonly text: string
}

/**
 * Each written description by its kind and place, an anchor renamed under its new name: two
 * kinds may share a place (a screen named `model` and the model's own description), one kind
 * never; a side holding two at one place is refused, as keeping either would hide the other.
 */
function textsOf(
  contract: Contract | undefined,
  renamedTo: ReadonlyMap<string, string>,
): Map<string, Paired> {
  const texts = new Map<string, Paired>()

  for (const { kind, place, text } of contract?.descriptions ?? []) {
    const named = kind === 'anchor' ? (renamedTo.get(place) ?? place) : place
    const key = JSON.stringify([kind, named])

    if (texts.has(key)) {
      throw new Error(`two written descriptions of the ${kind} ${named}`)
    }

    texts.set(key, { kind, place: named, text })
  }

  return texts
}

/** The pairs by their place, then by their kind. */
const byPlace = (a: Paired, b: Paired): number => byName(a.place, b.place) || byName(a.kind, b.kind)

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
  const keys = [...new Set([...was.keys(), ...is.keys()])]
  const pairs = keys.flatMap((key) => {
    const old = was.get(key)
    const now = is.get(key)
    const either = now ?? old

    return either === undefined || old?.text === now?.text ? [] : [{ old, now, either }]
  })

  return pairs
    .sort((a, b) => byPlace(a.either, b.either))
    .map(({ old, now, either }) => ({
      place: either.place,
      ...(old === undefined ? {} : { before: descriptionLength(old.text) }),
      ...(now === undefined ? {} : { after: descriptionLength(now.text) }),
    }))
}
