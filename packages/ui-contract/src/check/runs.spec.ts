import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import {
  activityIn,
  activityStateIn,
  flowIn,
  flowStateIn,
  sampleContract,
} from './contract.fixture'
import { runsProblems } from './runs'

describe('runsProblems', () => {
  it('finds nothing when every flow and activity runs in XState as written', () => {
    expect(runsProblems(sampleContract()).map(formatProblem)).toEqual([])
  })

  it('walks a flow with a guard by failure code beside an activity whose guards are sentences', () => {
    const contract = sampleContract()
    const { invoke } = flowStateIn(contract, 'saving')

    if (invoke === undefined) {
      throw new Error('the sample saves through an invoke')
    }

    flowIn(contract).meta = {
      guards: { titleGiven: 'the title input holds a title', broke: { codes: ['failed'] } },
    }
    invoke.onError = [{ guard: 'broke', target: 'editing' }, { target: 'editing' }]

    expect(runsProblems(contract).map(formatProblem)).toEqual([])
  })

  it('tells a flow XState will not build, in its screen file', () => {
    const contract = sampleContract()

    flowStateIn(contract, 'editing').on = { 'sample.save-button': { target: 'nowhere' } }

    const printed = runsProblems(contract).map(formatProblem)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatch(
      /^contract\/domain\/screens\/sample\/\$key\.yaml:\d+: flow: XState does not build or run the machine: /,
    )
  })

  it("tells a state of an activity XState does not reach, at that state's line", () => {
    const contract = {
      ...sampleContract(),
      activityLines: new Map([['thing', { 'states.island': 12 }]]),
    }

    activityIn(contract).states['island'] = {
      meta: { screen: 'sample', address: { path: '/sample/$key' } },
      type: 'final',
    }

    expect(runsProblems(contract).map(formatProblem)).toEqual([
      'contract/domain/activities/thing.yaml:12: island: XState does not reach this state',
    ])
  })

  it('tells an activity XState will not build, in its activity file', () => {
    const contract = sampleContract()
    const [first] = Object.keys(contract.activities[0]?.states ?? {})
    const state = activityStateIn(contract, first ?? expect.unreachable('a state'))

    state.on = { 'sample.save-button': { target: 'nowhere' } }

    const printed = runsProblems(contract).map(formatProblem)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatch(
      /^contract\/domain\/activities\/thing\.yaml:\d+: XState does not build or run the machine: /,
    )
  })
})
