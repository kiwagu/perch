import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { activityIn, activityStateIn, sampleContract } from '../check/contract.fixture'
import type { Scenario } from '../scenarios'

import { activityCoverage } from './activities'

function scenarioIn(contract: Contract): Scenario {
  const [scenario] = contract.scenarios

  if (scenario === undefined) {
    throw new Error('no scenario')
  }

  return scenario
}

/** The sample with its activity's `saved` state at `/other`, walked by a scenario of `steps`. */
function walking(where: string, steps: string[]): Contract {
  const contract = sampleContract()

  activityStateIn(contract, 'saved').meta.address.path = '/other'
  Object.assign(scenarioIn(contract), { where, steps })

  return contract
}

const walkedIn = (contract: Contract): number[] =>
  activityCoverage(contract).map(({ walked }) => walked)

describe('activityCoverage', () => {
  it('counts per activity the scenarios that name it and its transitions, none walked outside a step', () => {
    expect(activityCoverage(sampleContract())).toEqual([
      { id: 'thing', scenarios: 1, transitions: 2, walked: 0 },
    ])
  })
  it('counts a transition walked when a step names its anchor and the route before it is the address of its state', () => {
    expect(
      walkedIn(
        walking('[/sample/$key]', [
          'Click [sample.save-button]',
          'Open [/other]',
          'Follow [sample.home-link]',
        ]),
      ),
    ).toEqual([2])
  })
  it('counts no walk of an anchor named while the most recent route addresses another state', () => {
    expect(
      walkedIn(
        walking('[/sample/$key]', [
          'Follow [sample.home-link]',
          'Open [/other]',
          'Click [sample.save-button]',
        ]),
      ),
    ).toEqual([0])
  })
  it('counts a step before any route against the initial state', () => {
    expect(walkedIn(walking('A member at the thing', ['Click [sample.save-button]']))).toEqual([1])
  })
  it('reads the references of a text in their order, a route before an anchor included', () => {
    expect(
      walkedIn(walking('[/sample/$key]', ['Open [/other] and follow [sample.home-link]'])),
    ).toEqual([1])
    expect(
      walkedIn(walking('[/sample/$key]', ['Open [/other] and click [sample.save-button]'])),
    ).toEqual([0])
  })
  it('walks the where, the steps and the expected results in the order of the file', () => {
    const contract = walking('[/sample/$key]', ['Follow [sample.home-link]'])

    scenarioIn(contract).expected = ['The page is on [/other]']

    expect(walkedIn(contract)).toEqual([0])
    expect(
      walkedIn({
        ...contract,
        scenarioLines: new Map([
          ['sample/base/thing', { where: 3, 'expected[0]': 6, 'steps[0]': 9 }],
        ]),
      }),
    ).toEqual([1])
  })
  it('keeps the address of each device apart, by the device a text opens with', () => {
    const contract = walking('[/other] on device A, and [/sample/$key] on device B', [
      'On device A, open [/other]',
      'On device B, wait for [/sample/$key]',
      'On device A, follow [sample.home-link]',
    ])

    scenarioIn(contract).devices = { A: 'member', B: 'member' }

    expect(walkedIn(contract)).toEqual([1])
  })
  it('gives a text that names no device to the device last named, A at first', () => {
    const contract = walking('[/sample/$key]', [
      'Device B: open [/other]',
      'On device A, wait',
      'Follow [sample.home-link]',
    ])
    const scenario = scenarioIn(contract)

    scenario.devices = { A: 'member', B: 'member' }

    expect(walkedIn(contract)).toEqual([0])

    scenario.steps.push('On device B, follow [sample.home-link]')

    expect(walkedIn(contract)).toEqual([1])
  })
  it('gives every text to the one device of a scenario that has one', () => {
    expect(
      walkedIn(
        walking('[/sample/$key]', ['On device B, open [/other]', 'Follow [sample.home-link]']),
      ),
    ).toEqual([1])
  })
  it('counts a route that addresses several states for each of them', () => {
    const contract = sampleContract()

    scenarioIn(contract).steps.push('Click [sample.save-button]', 'Follow [sample.home-link]')

    expect(walkedIn(contract)).toEqual([2])
  })
  it('counts no walk by a scenario that names another activity, or none', () => {
    const contract = sampleContract()
    const scenario = scenarioIn(contract)

    delete scenario.activity
    scenario.steps.push('Click [sample.save-button]')
    contract.activities.push({ ...structuredClone(activityIn(contract)), id: 'other' })

    expect(activityCoverage(contract)).toEqual([
      { id: 'thing', scenarios: 0, transitions: 2, walked: 0 },
      { id: 'other', scenarios: 0, transitions: 2, walked: 0 },
    ])
  })
})
