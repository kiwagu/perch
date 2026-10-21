import { describe, expect, it } from 'vitest'

import { formatProblem, type Scenario } from '../files'

import { sampleContract } from './contract.fixture'
import { scenariosProblems } from './scenarios'

const printed = (contract = sampleContract()): string[] =>
  scenariosProblems(contract).map(formatProblem)

function firstScenario(contract: ReturnType<typeof sampleContract>): Scenario {
  const [scenario] = contract.screens.scenarios

  if (scenario === undefined) {
    throw new Error('no scenario')
  }

  return scenario
}

describe('scenariosProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('wants every bracket reference to resolve', () => {
    const contract = sampleContract()
    const scenario = firstScenario(contract)

    scenario.where = '[/elsewhere]'
    scenario.scenario = 'A member sees [sample.gone-button] and [sample.page.confirm-button]'
    scenario.steps = ['Wait for [state:busy]', 'Choose [value:c] or [value:kx]', 'Click [Save]']
    scenario.expected = ['It shows [code:lost]']

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: scenarios[0].where: [/elsewhere] is the path of no binding',
      'contract/screens.json:1: scenarios[0].scenario: [sample.gone-button] is not a declared anchor',
      'contract/screens.json:1: scenarios[0].steps[0]: [state:busy] is not a state of the vocabulary',
      'contract/screens.json:1: scenarios[0].steps[1]: [value:c] is not a choice value of the vocabulary',
      'contract/screens.json:1: scenarios[0].steps[1]: [value:kx] is not a choice value of the vocabulary',
      'contract/screens.json:1: scenarios[0].steps[2]: not an anchor, a route, a code, a state or a value: "Save"',
      'contract/screens.json:1: scenarios[0].expected[0]: [code:lost] is not a code of the vocabulary',
    ])
  })
  it('wants every device to act as a role of the vocabulary', () => {
    const contract = sampleContract()

    firstScenario(contract).devices = { A: 'member', B: 'visitor' }

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: scenarios[0].devices.B: "visitor" is not a role of the vocabulary',
    ])
  })
  it('wants every scenario id once', () => {
    const contract = sampleContract()

    contract.screens.scenarios.push(structuredClone(firstScenario(contract)))

    expect(printed(contract)).toEqual([
      'contract/screens.json:1: scenarios[1].id: "sample/01-edit" is the id of another scenario',
    ])
  })
})
