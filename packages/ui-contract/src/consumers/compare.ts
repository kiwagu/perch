/**
 * What the e2e tests name against the contract: every anchor a known one (declared, or
 * derived from a declared base with a suffix it lists in `derived`), every code a code of the
 * vocabulary, every state one of its states and every value one of its choice values, or `show`
 * or `hide` once an input renders a visibility-button, as the scenarios check resolves its
 * bracket references. The problems carry `file:line`, sorted.
 */

import { type Contract, referenceResolver } from '../check'
import { type Problem, sortProblems } from '../files'

import type { Consumed } from './scan'

export function compareConsumers(consumed: readonly Consumed[], contract: Contract): Problem[] {
  const resolve = referenceResolver(contract)

  return sortProblems(
    consumed.flatMap(({ file, literals, problems }) => [
      ...problems,
      ...literals.flatMap(({ kind, value, line }) => {
        const unresolved = resolve({ kind, value, raw: JSON.stringify(value) })

        return unresolved === undefined ? [] : [{ file, line, message: unresolved }]
      }),
    ]),
  )
}
