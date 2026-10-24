import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { activityStateIn, flowStateIn, sampleContract } from './contract.fixture'
import { runsProblems } from './runs'

describe('runsProblems', () => {
  it('finds nothing when every flow and activity runs in XState as written', () => {
    expect(runsProblems(sampleContract()).map(formatProblem)).toEqual([])
  })

  it('tells a flow XState will not build, in its screen file', () => {
    const contract = sampleContract()

    flowStateIn(contract, 'editing').on = { 'sample.save-button': { target: 'nowhere' } }

    const printed = runsProblems(contract).map(formatProblem)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatch(
      /^contract\/screens\/sample\/\$key\.yaml:\d+: flow: XState does not build or run the machine: /,
    )
  })

  it('tells an activity XState will not build, in its activity file', () => {
    const contract = sampleContract()
    const [first] = Object.keys(contract.activities[0]?.states ?? {})
    const state = activityStateIn(contract, first ?? expect.unreachable('a state'))

    state.on = { 'sample.save-button': { target: 'nowhere' } }

    const printed = runsProblems(contract).map(formatProblem)

    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatch(
      /^contract\/activities\/thing\.yaml:\d+: XState does not build or run the machine: /,
    )
  })
})
