/**
 * The platform values of a change, for its hand-over: the values one contract adds or removes
 * against another by name, and, for each value both hold, each keyword whose value changes,
 * compared as data, as `<name> <keyword> <before> -> <after>`, each side its JSON (`wordOf`),
 * `none` on the side that lacks it. Its description is a description change of its own.
 */

import type { Contract } from '../check'
import { sameValue } from '../records'

import { byName, type Change, changeOf } from './change'
import { VALUE_KEYWORDS, wordOf } from './value-words'

/** The values added and removed by name, and the keywords changed of each value both hold. */
export type ValueChanges = Change & { changed: string[] }

/** The platform values of a contract by name; none for a contract left undefined. */
const valuesOf = (contract: Contract | undefined) => contract?.screens.platform.values ?? {}

export function valueChanges(
  before: Contract | undefined,
  after: Contract | undefined,
): ValueChanges {
  const was = valuesOf(before)
  const is = valuesOf(after)
  const changed = Object.entries(is).flatMap(([name, value]) => {
    const old = Object.hasOwn(was, name) ? was[name] : undefined

    return old === undefined
      ? []
      : VALUE_KEYWORDS.flatMap((keyword) =>
          sameValue(old[keyword], value[keyword])
            ? []
            : [`${name} ${keyword} ${wordOf(old[keyword])} -> ${wordOf(value[keyword])}`],
        )
  })

  return { ...changeOf(Object.keys(was), Object.keys(is)), changed: changed.sort(byName) }
}
