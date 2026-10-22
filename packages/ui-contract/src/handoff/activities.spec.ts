import { describe, expect, it } from 'vitest'

import { activityIn, sampleContract } from '../check/contract.fixture'

import { activityCoverage } from './activities'

describe('activityCoverage', () => {
  it('counts per activity the scenarios that name it and the transitions they walk', () => {
    expect(activityCoverage(sampleContract())).toEqual([
      { id: 'thing', scenarios: 1, transitions: 2, walked: 1 },
    ])
  })
  it('counts a transition walked once one of those scenarios names its anchor in brackets', () => {
    const contract = sampleContract()
    const [scenario] = contract.scenarios

    scenario?.steps.push('Follow [sample.home-link]')

    expect(activityCoverage(contract)).toEqual([
      { id: 'thing', scenarios: 1, transitions: 2, walked: 2 },
    ])
  })
  it('counts no walk by a scenario that names another activity, or none', () => {
    const contract = sampleContract()
    const [scenario] = contract.scenarios

    delete scenario?.activity
    contract.activities.push({ ...structuredClone(activityIn(contract)), id: 'other' })

    expect(activityCoverage(contract)).toEqual([
      { id: 'thing', scenarios: 0, transitions: 2, walked: 0 },
      { id: 'other', scenarios: 0, transitions: 2, walked: 0 },
    ])
  })
})
