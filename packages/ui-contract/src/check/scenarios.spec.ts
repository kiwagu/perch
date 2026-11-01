import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'
import { fixtureContract } from '../manifest/manifest.fixture'
import type { Scenario } from '../scenarios'

import { sampleContract, screenIn } from './contract.fixture'
import { scenariosProblems } from './scenarios'

const printed = (contract = sampleContract()): string[] =>
  scenariosProblems(contract).map(formatProblem)

function firstScenario(contract: ReturnType<typeof sampleContract>): Scenario {
  const [scenario] = contract.scenarios

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
      'tests/e2e/scenarios/sample/base/thing.md:1: where: [/elsewhere] is the path of no binding',
      'tests/e2e/scenarios/sample/base/thing.md:1: scenario: [sample.gone-button] is not a declared anchor',
      'tests/e2e/scenarios/sample/base/thing.md:1: scenario: [sample.page.confirm-button] is not a declared anchor',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[0]: [state:busy] is not a state of the vocabulary',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[1]: [value:c] is not a choice value of the vocabulary',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[1]: [value:kx] is not a choice value of the vocabulary',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[2]: not an anchor, a route, a code, a state, a value or a mail: "Save"',
      'tests/e2e/scenarios/sample/base/thing.md:1: expected[0]: [code:lost] is not a code of the vocabulary',
    ])
  })
  it('resolves a toast code the loader derived, which the vocabulary lists by its rule row', () => {
    const contract = sampleContract()

    firstScenario(contract).expected = ['It shows [code:thing-created]']

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: expected[0]: [code:thing-created] is not a code of the vocabulary',
    ])

    contract.screens.toasts = [
      { anchor: 'sample.save-button', code: 'thing-created', action: 'thing.createThing' },
    ]

    expect(printed(contract)).toEqual([])
  })
  it('names a visibility-button and its values, show and hide, once an input renders one', () => {
    const contract = sampleContract()

    firstScenario(contract).steps = [
      'Click [sample.title-input.visibility-button] while it carries [value:show]',
      'Then it carries [value:hide]',
    ]

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[0]: [sample.title-input.visibility-button] is not a declared anchor',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[0]: [value:show] is not a choice value of the vocabulary',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[1]: [value:hide] is not a choice value of the vocabulary',
    ])

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })

    expect(printed(contract)).toEqual([])
  })
  it('resolves a mail by the platform action that declares it', () => {
    const contract = sampleContract()
    const scenario = firstScenario(contract)

    Object.assign(contract.screens.platform.actions, {
      'invite.send': {
        description: 'Sends an invitation.',
        params: { email: { type: 'string', description: 'The address.' } },
        result: 'a mail is on its way',
        codes: ['failed'],
        mail: { to: 'email', language: 'account', link: { screen: 'sample', search: 'tab' } },
      },
    })
    scenario.steps = [
      'Open the link of [mail:invite.send]',
      'And of [mail:sign-out]',
      'And of [mail:gone]',
    ]

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[1]: [mail:sign-out] names no platform action that sends a mail',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[2]: [mail:gone] names no platform action that sends a mail',
    ])
  })
  it('wants every device to act as a role of the vocabulary', () => {
    const contract = sampleContract()

    firstScenario(contract).devices = { A: 'member', B: 'visitor' }

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: devices.B: "visitor" is not a role of the vocabulary',
    ])
  })
  it('wants the activity a scenario names to be one of contract/domain/activities', () => {
    const contract = sampleContract()

    firstScenario(contract).activity = 'gone'

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: activity: "gone" is not an activity of contract/domain/activities',
    ])
  })
  it('reports each problem at the line of its field in the file, the deepest the file holds', () => {
    const contract = fixtureContract()
    const scenario = firstScenario(contract)

    scenario.activity = 'gone'
    scenario.devices = { A: 'member', B: 'visitor' }
    scenario.expected = ['[sample.save-button] saves with [code:saved]', 'It shows [code:lost]']

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:4: activity: "gone" is not an activity of contract/domain/activities',
      'tests/e2e/scenarios/sample/base/thing.md:5: devices.B: "visitor" is not a role of the vocabulary',
      'tests/e2e/scenarios/sample/base/thing.md:12: where: [/sample] is the path of no binding',
      'tests/e2e/scenarios/sample/base/thing.md:17: steps[0]: [/sample] is the path of no binding',
      'tests/e2e/scenarios/sample/base/thing.md:20: expected[1]: [code:lost] is not a code of the vocabulary',
    ])
  })
  it('resolves a derived anchor only through a suffix its base lists in derived', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').anchors['sample.sign-out-dialog'] = {
      kind: 'dialog',
      derived: ['confirm-button'],
    }
    firstScenario(contract).steps = [
      'Click [sample.save-button.confirm-button]',
      'Click [sample.sign-out-dialog.confirm-button]',
      'Pick [sample.mode-select.option] or [sample.mode-select.item]',
    ]

    expect(printed(contract)).toEqual([
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[0]: [sample.save-button.confirm-button] is not a declared anchor',
      'tests/e2e/scenarios/sample/base/thing.md:1: steps[2]: [sample.mode-select.item] is not a declared anchor',
    ])
  })
})
