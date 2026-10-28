import { describe, expect, it } from 'vitest'

import { fixtureContract } from '../manifest/manifest.fixture'

import { toastsProblems } from './toasts'

describe('toastsProblems', () => {
  it('accepts a toast for an action the platform declares', () => {
    const contract = fixtureContract()

    contract.screens.platform.toasts = { 'sign-out': 'signed-out-here' }

    expect(toastsProblems(contract)).toEqual([])
  })

  it('names an action of the map the platform does not declare', () => {
    const contract = fixtureContract()

    contract.screens.platform.toasts = { 'sign-out': 'signed-out-here', 'things.drop': 'dropped' }

    expect(toastsProblems(contract).map(({ message }) => message)).toEqual([
      'toasts["things.drop"]: "things.drop" is no action of platform.actions',
    ])
  })
})
