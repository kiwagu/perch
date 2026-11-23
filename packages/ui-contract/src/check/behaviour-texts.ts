/**
 * The budget of a platform action's behaviour texts: each line of a `result` written as a list,
 * each condition a code answers on, and each invariant's rule keep `DESCRIPTION_BUDGET`
 * characters, the budget of a written description. One past it is a problem at its place, with
 * its length and the purpose of its field. A `result` written as one string is one outcome line,
 * held from version 6 (`BEHAVIOUR_EDITION`); a contract at an older version keeps it as it was.
 */

import { codeEntriesOf, type Problem } from '../files'
import {
  BEHAVIOUR_PURPOSES,
  type BehaviourKind,
  DESCRIPTION_BUDGET,
  descriptionLength,
} from '../schemas'

import { BEHAVIOUR_EDITION } from './action-forms'
import { type Contract, locate } from './contract'
import { since } from './editions'

const NOUNS: Readonly<Record<BehaviourKind, string>> = {
  outcome: 'the outcome line',
  condition: 'the condition',
  rule: 'the rule',
}

type Action = Contract['screens']['platform']['actions'][string]

/** A text of the platform at `at` in it, with the kind of its field. */
interface BehaviourText {
  readonly at: readonly PropertyKey[]
  readonly kind: BehaviourKind
  readonly text: string
}

/** The outcome lines of an action's `result`: a list's by index, one string's from version 6. */
function outcomeTexts(name: string, result: Action['result'], held: boolean): BehaviourText[] {
  if (typeof result === 'string') {
    return held
      ? [{ at: ['platform', 'actions', name, 'result'], kind: 'outcome', text: result }]
      : []
  }

  return result.map((text, index) => ({
    at: ['platform', 'actions', name, 'result', index],
    kind: 'outcome' as const,
    text,
  }))
}

/**
 * Every behaviour text of the platform the budget holds, in the order the file writes them; a
 * `result` of one string only where `strings` holds it.
 */
function behaviourTexts(
  { actions, invariants }: Contract['screens']['platform'],
  strings: boolean,
): BehaviourText[] {
  return [
    ...Object.entries(actions).flatMap(([name, action]): BehaviourText[] => [
      ...outcomeTexts(name, action.result, strings),
      ...codeEntriesOf(action.codes).flatMap(({ at, condition, invariants }) =>
        condition === undefined
          ? []
          : [
              {
                // A condition beside invariants is the object's `condition`; alone, the code's value.
                at: [
                  'platform',
                  'actions',
                  name,
                  'codes',
                  at,
                  ...(invariants.length > 0 ? ['condition'] : []),
                ],
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

  return behaviourTexts(contract.screens.platform, since(contract, BEHAVIOUR_EDITION)).flatMap(
    ({ at, kind, text }) => {
      const length = descriptionLength(text)

      return length > DESCRIPTION_BUDGET
        ? [
            inScreens(
              at,
              `${NOUNS[kind]} is ${length} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES[kind]}"`,
            ),
          ]
        : []
    },
  )
}
