import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE } from '../files'

import { actionFormsProblems } from './action-forms'
import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { contractProblems } from './run'

type Codes = Contract['screens']['platform']['actions'][string]['codes']

/** The sample at `version` whose one action, `sign-in`, fails with `codes`. */
function signingIn(version: number, codes: Codes): Contract {
  const contract = sampleContract()

  contract.screens.platform.actions = {
    'sign-in': {
      description: 'Signs this device in.',
      params: {},
      result: 'the device is signed in',
      codes,
      changes: [],
    },
  }

  return { ...contract, screens: { ...contract.screens, version } }
}

const LIST = `a list of codes; from version 6 an action's codes are a map, each code with when it answers: \`<code>: <condition>\`, or \`<code>: { invariant: <name> }\` for a rule several actions keep; an empty list is \`codes: {}\``
const problem = (message: string) => ({ file: PLATFORM_FILE, message })

describe('actionFormsProblems', () => {
  it('passes the codes of a version 6 action written as a map, an empty one included', () => {
    expect(
      actionFormsProblems(
        signingIn(6, { failed: 'the password is wrong', 'device-limit': { invariant: 'limit' } }),
      ),
    ).toEqual([])
    expect(actionFormsProblems(signingIn(6, {}))).toEqual([])
  })
  it('refuses the codes of a version 6 action written as a list, an empty one included, at the codes', () => {
    expect(actionFormsProblems(signingIn(6, ['failed']))).toEqual([
      problem(`actions["sign-in"].codes: ${LIST}`),
    ])
    expect(actionFormsProblems(signingIn(6, []))).toEqual([
      problem(`actions["sign-in"].codes: ${LIST}`),
    ])
  })
  it('leaves the list to a contract before version 6, which loads it as before', () => {
    expect(actionFormsProblems(signingIn(5, ['failed']))).toEqual([])
    expect(actionFormsProblems(sampleContract())).toEqual([])
  })
  it('runs among the rules of the contract check', () => {
    expect(contractProblems(signingIn(6, ['failed']))).toContainEqual(
      problem(`actions["sign-in"].codes: ${LIST}`),
    )
  })
})
