/**
 * Rule 6: the scenarios speak of what the contract declares. Every bracket reference in
 * their text resolves (an anchor declared, or derived from a declared base with a suffix it
 * lists in `derived`, the path of a binding, a code, a state, a choice value or a value a
 * pattern row matches), every device
 * acts as a role of the vocabulary, and each id is used once.
 */

import type { Problem, Scenario } from '../files'
import { type Reference, referencesIn } from '../scenarios'

import {
  bindingPaths,
  type Contract,
  has,
  inScreens,
  isChoiceValue,
  knownAnchors,
  statesOf,
} from './contract'

/** The text fields of a scenario that carry bracket references, with their paths. */
export const textsOf = (scenario: Scenario): Array<{ text: string; at: PropertyKey[] }> => [
  { text: scenario.where, at: ['where'] },
  { text: scenario.scenario, at: ['scenario'] },
  ...scenario.steps.map((text, index) => ({ text, at: ['steps', index] })),
  ...scenario.expected.map((text, index) => ({ text, at: ['expected', index] })),
]

function resolver(contract: Contract): (reference: Reference) => string | undefined {
  const known = knownAnchors(contract)
  const paths = bindingPaths(contract.screens)
  const states = statesOf(contract.vocabulary)
  const { vocabulary } = contract

  return ({ kind, value, raw }) => {
    switch (kind) {
      case 'anchor':
        return known(value) ? undefined : `${raw} is not a declared anchor`
      case 'route':
        return paths.has(value) ? undefined : `${raw} is the path of no binding`
      case 'code':
        return has(vocabulary.codes, value) ? undefined : `${raw} is not a code of the vocabulary`
      case 'state':
        return states.has(value) ? undefined : `${raw} is not a state of the vocabulary`
      case 'value':
        return isChoiceValue(vocabulary, value)
          ? undefined
          : `${raw} is not a choice value of the vocabulary`
    }
  }
}

export function scenariosProblems(contract: Contract): Problem[] {
  const resolve = resolver(contract)
  const ids = new Set<string>()

  return contract.screens.scenarios.flatMap((scenario, index) => {
    const at = ['scenarios', index]
    const repeated = ids.has(scenario.id)

    ids.add(scenario.id)

    return [
      ...(repeated
        ? [inScreens([...at, 'id'], `"${scenario.id}" is the id of another scenario`)]
        : []),
      ...Object.entries(scenario.devices).flatMap(([device, role]) =>
        has(contract.vocabulary.roles, role)
          ? []
          : [inScreens([...at, 'devices', device], `"${role}" is not a role of the vocabulary`)],
      ),
      ...textsOf(scenario).flatMap(({ text, at: field }) => {
        const { references, problems } = referencesIn(text)

        return [
          ...references.flatMap((reference) => {
            const problem = resolve(reference)

            return problem === undefined ? [] : [inScreens([...at, ...field], problem)]
          }),
          ...problems.map((problem) => inScreens([...at, ...field], problem)),
        ]
      }),
    ]
  })
}
