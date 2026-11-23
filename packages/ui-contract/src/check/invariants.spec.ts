import { describe, expect, it } from 'vitest'

import { PLATFORM_FILE } from '../files'

import type { Contract } from './contract'
import { sampleContract } from './contract.fixture'
import { invariantsProblems } from './invariants'
import { contractProblems } from './run'

type Codes = Contract['screens']['platform']['actions'][string]['codes']

/** The sample with an action `sign-in` failing with `codes` and the platform's `invariants`. */
function signingIn(
  codes: Codes,
  invariants: Contract['screens']['platform']['invariants'],
): Contract {
  const contract = sampleContract()

  contract.screens.platform.actions['sign-in'] = {
    description: 'Signs this device in.',
    params: {},
    result: 'the device is signed in',
    codes,
    changes: [],
  }
  contract.screens.platform.invariants = invariants

  return contract
}

const DEVICE_LIMIT = {
  'device-limit': { rule: 'Ten devices at most at once.', refuses: 'device-limit' },
}
const problem = (message: string) => ({ file: PLATFORM_FILE, message })

describe('invariantsProblems', () => {
  it('passes an invariant an action names under the code it refuses with', () => {
    expect(
      invariantsProblems(
        signingIn({ 'device-limit': { invariant: 'device-limit' } }, DEVICE_LIMIT),
      ),
    ).toEqual([])
  })
  it('passes a contract with no invariants and codes as a list or with conditions', () => {
    expect(invariantsProblems(sampleContract())).toEqual([])
    expect(invariantsProblems(signingIn({ failed: 'anything else fails' }, undefined))).toEqual([])
  })
  it('refuses an invariant the platform does not declare, at the code that names it', () => {
    expect(
      invariantsProblems(signingIn({ 'device-limit': { invariant: 'devices' } }, DEVICE_LIMIT)),
    ).toEqual([
      problem(
        'actions["sign-in"].codes["device-limit"]: "devices" is no invariant of platform.invariants',
      ),
      problem(
        'invariants["device-limit"]: no action names the invariant "device-limit": an action that keeps it names it under the code it refuses with, `device-limit: { invariant: device-limit }`',
      ),
    ])
  })
  it('refuses an invariant named under a code it does not refuse with, at that code', () => {
    expect(
      invariantsProblems(
        signingIn(
          {
            'device-limit': { invariant: 'device-limit' },
            failed: { invariant: 'device-limit' },
          },
          DEVICE_LIMIT,
        ),
      ),
    ).toEqual([
      problem(
        'actions["sign-in"].codes.failed: the invariant "device-limit" refuses with "device-limit", so an action names it under that code, not under "failed"',
      ),
    ])
  })
  it('refuses an invariant no action names, at the invariant', () => {
    expect(
      invariantsProblems(
        signingIn(['device-limit'], {
          ...DEVICE_LIMIT,
          'last-admin': { rule: 'An organisation keeps an administrator.', refuses: 'last-admin' },
        }),
      ),
    ).toEqual([
      problem(
        'invariants["device-limit"]: no action names the invariant "device-limit": an action that keeps it names it under the code it refuses with, `device-limit: { invariant: device-limit }`',
      ),
      problem(
        'invariants["last-admin"]: no action names the invariant "last-admin": an action that keeps it names it under the code it refuses with, `last-admin: { invariant: last-admin }`',
      ),
    ])
  })
  it('holds each invariant of a list to existing and refusing with the code, at that code', () => {
    const invariants = {
      ...DEVICE_LIMIT,
      'failed-sign-ins': { rule: 'Ten wrong passwords keep it out.', refuses: 'rate-limited' },
    }

    expect(
      invariantsProblems(
        signingIn(
          {
            'device-limit': { invariant: 'device-limit' },
            'rate-limited': {
              invariant: ['failed-sign-ins', 'mails', 'device-limit'],
              condition: 'a fourth sign-in within a minute',
            },
          },
          invariants,
        ),
      ),
    ).toEqual([
      problem(
        'actions["sign-in"].codes["rate-limited"]: "mails" is no invariant of platform.invariants',
      ),
      problem(
        'actions["sign-in"].codes["rate-limited"]: the invariant "device-limit" refuses with "device-limit", so an action names it under that code, not under "rate-limited"',
      ),
    ])
  })
  it('runs among the rules of the contract check', () => {
    expect(
      contractProblems(signingIn({ 'device-limit': { invariant: 'devices' } }, undefined)),
    ).toContainEqual(
      problem(
        'actions["sign-in"].codes["device-limit"]: "devices" is no invariant of platform.invariants',
      ),
    )
  })
})
