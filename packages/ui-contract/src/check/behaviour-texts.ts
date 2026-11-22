/**
 * The budget of a platform action's behaviour texts: each line of a `result` written as a list,
 * each condition a code answers on, and each invariant's rule keep `DESCRIPTION_BUDGET`
 * characters, the budget of a written description. One past it is a problem at its place, with
 * its length and the purpose of its field. A `result` written as one string is the older form and
 * is not held here.
 */

import { codeEntriesOf, type Problem } from '../files'
import {
  BEHAVIOUR_PURPOSES,
  type BehaviourKind,
  DESCRIPTION_BUDGET,
  descriptionLength,
} from '../schemas'

import { type Contract, locate } from './contract'

const NOUNS: Readonly<Record<BehaviourKind, string>> = {
  outcome: 'the outcome line',
  condition: 'the condition',
  rule: 'the rule',
}

/** A text of the platform at `at` in it, with the kind of its field. */
interface BehaviourText {
  readonly at: readonly PropertyKey[]
  readonly kind: BehaviourKind
  readonly text: string
}

/** Every behaviour text of the platform the budget holds, in the order the file writes them. */
function behaviourTexts({ actions, invariants }: Contract['screens']['platform']): BehaviourText[] {
  return [
    ...Object.entries(actions).flatMap(([name, action]): BehaviourText[] => [
      ...(typeof action.result === 'string'
        ? []
        : action.result.map((text, index) => ({
            at: ['platform', 'actions', name, 'result', index],
            kind: 'outcome' as const,
            text,
          }))),
      ...codeEntriesOf(action.codes).flatMap(({ at, condition }) =>
        condition === undefined
          ? []
          : [
              {
                at: ['platform', 'actions', name, 'codes', at],
                kind: 'condition' as const,
                text: condition,
              },
            ],
      ),
    ]),
    ...Object.entries(invariants ?? {}).map(([name, { rule }]) => ({
      at: ['platform', 'invariants', name, 'rule'],
      kind: 'rule' as const,
      text: rule,
    })),
  ]
}

export function behaviourTextsProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return behaviourTexts(contract.screens.platform).flatMap(({ at, kind, text }) => {
    const length = descriptionLength(text)

    return length > DESCRIPTION_BUDGET
      ? [
          inScreens(
            at,
            `${NOUNS[kind]} is ${length} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES[kind]}"`,
          ),
        ]
      : []
  })
}
