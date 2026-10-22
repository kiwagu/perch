/**
 * Rule 6: the scenarios speak of what the contract declares. Every bracket reference in
 * their text resolves (an anchor declared, or derived from a declared base with a suffix it
 * lists in `derived`, the path of a binding, a code, a state, a choice value or a value a
 * pattern row matches), and every device acts as a role of the vocabulary. Each problem is
 * one of the scenario's file, named by its field; the ids are paths, so each is used once.
 */

import { type Problem, scenarioFile } from '../files'
import { jsonPath } from '../files/problems'
import { type Reference, referencesIn, type Scenario } from '../scenarios'

import {
  bindingPaths,
  type Contract,
  has,
  inScenario,
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

  return contract.scenarios.flatMap((scenario) => {
    const file = scenarioFile(scenario.id)
    const problem = (at: readonly PropertyKey[], message: string): Problem =>
      inScenario(file, `${jsonPath(at)}: ${message}`)

    return [
      ...Object.entries(scenario.devices).flatMap(([device, role]) =>
        has(contract.vocabulary.roles, role)
          ? []
          : [problem(['devices', device], `"${role}" is not a role of the vocabulary`)],
      ),
      ...textsOf(scenario).flatMap(({ text, at }) => {
        const { references, problems } = referencesIn(text)

        return [
          ...references.flatMap((reference) => {
            const unresolved = resolve(reference)

            return unresolved === undefined ? [] : [problem(at, unresolved)]
          }),
          ...problems.map((message) => problem(at, message)),
        ]
      }),
    ]
  })
}
