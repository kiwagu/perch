import { describe, expect, it } from 'vitest'

import { fixtureContract } from '../manifest/manifest.fixture'

import { leavingProblems } from './leaving'

describe('leavingProblems', () => {
  it('accepts actions of the model and the platform, listed once', () => {
    const contract = fixtureContract()

    contract.screens.platform.leaving = ['thing.createThing', 'platform.sign-out']

    expect(leavingProblems(contract)).toEqual([])
  })

  it('names an action that does not exist and one listed twice', () => {
    const contract = fixtureContract()

    contract.screens.platform.leaving = [
      'thing.dropThing',
      'thing.createThing',
      'thing.createThing',
    ]

    expect(leavingProblems(contract).map(({ message }) => message)).toEqual([
      expect.stringContaining('leaving[0]'),
      'leaving[2]: "thing.createThing" is listed twice',
    ])
  })
})
