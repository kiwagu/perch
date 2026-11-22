import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE } from '../files'
import { BEHAVIOUR_PURPOSES, DESCRIPTION_BUDGET } from '../schemas'

import { behaviourTextsProblems } from './behaviour-texts'
import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { contractProblems } from './run'

type Action = Contract['screens']['platform']['actions'][string]

/** The sample with an action `sign-in` writing `result` and `codes`, and the given invariants. */
function signingIn(
  result: Action['result'],
  codes: Action['codes'],
  invariants?: Contract['screens']['platform']['invariants'],
): Contract {
  const contract = sampleContract()

  contract.screens.platform.actions['sign-in'] = {
    description: 'Signs this device in.',
    params: {},
    result,
    codes,
    changes: [],
  }
  if (invariants !== undefined) {
    contract.screens.platform.invariants = invariants
  }

  return contract
}

const AT_BUDGET = 'é'.repeat(DESCRIPTION_BUDGET)
const PAST = `${'a'.repeat(DESCRIPTION_BUDGET)}é`
const problem = (message: string) => ({ file: PLATFORM_FILE, message })

describe('behaviourTextsProblems', () => {
  it('passes outcome lines, conditions and rules of exactly the budget, counted in characters', () => {
    expect(
      behaviourTextsProblems(
        signingIn(
          [AT_BUDGET, AT_BUDGET],
          { failed: AT_BUDGET },
          {
            limit: { rule: AT_BUDGET, refuses: 'failed' },
          },
        ),
      ),
    ).toEqual([])
  })
  it('refuses an outcome line of a list past the budget, at its line, with its purpose', () => {
    expect(behaviourTextsProblems(signingIn(['the device is signed in', PAST], []))).toEqual([
      problem(
        `actions["sign-in"].result[1]: the outcome line is ${DESCRIPTION_BUDGET + 1} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES.outcome}"`,
      ),
    ])
  })
  it('refuses a condition past the budget, at its code, with its purpose', () => {
    expect(
      behaviourTextsProblems(
        signingIn('the device is signed in', {
          'device-limit': { invariant: 'limit' },
          'rate-limited': PAST,
        }),
      ),
    ).toEqual([
      problem(
        `actions["sign-in"].codes["rate-limited"]: the condition is ${DESCRIPTION_BUDGET + 1} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES.condition}"`,
      ),
    ])
  })
  it('refuses a rule past the budget, at the rule, with its purpose', () => {
    expect(
      behaviourTextsProblems(
        signingIn('the device is signed in', [], { limit: { rule: PAST, refuses: 'failed' } }),
      ),
    ).toEqual([
      problem(
        `invariants.limit.rule: the rule is ${DESCRIPTION_BUDGET + 1} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES.rule}"`,
      ),
    ])
  })
  it('leaves a result written as one string to its older form, whatever its length', () => {
    expect(behaviourTextsProblems(signingIn(PAST.repeat(5), ['failed']))).toEqual([])
  })
  it('runs among the rules of the contract check', () => {
    expect(contractProblems(signingIn(['ok', PAST], []))).toContainEqual(
      problem(
        `actions["sign-in"].result[1]: the outcome line is ${DESCRIPTION_BUDGET + 1} characters, past its budget of ${DESCRIPTION_BUDGET}; its purpose: "${BEHAVIOUR_PURPOSES.outcome}"`,
      ),
    )
  })
})
