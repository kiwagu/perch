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
  it('passes an invariant whose rule names each of its values', () => {
    expect(
      invariantsProblems(
        signingIn(
          { 'device-limit': { invariant: 'device-limit' } },
          {
            'device-limit': {
              rule: '{limit} devices at most at once; the {limit} first stay.',
              refuses: 'device-limit',
              values: { limit: 10 },
            },
          },
        ),
      ),
    ).toEqual([])
  })
  it('refuses a placeholder that names no value, and a value its rule never names, at their place', () => {
    expect(
      invariantsProblems(
        signingIn(
          { 'device-limit': { invariant: 'device-limit' } },
          {
            'device-limit': {
              rule: '{limit} devices within {window}, {}.',
              refuses: 'device-limit',
              values: { limit: 10, spare: 2 },
            },
          },
        ),
      ),
    ).toEqual([
      problem(
        'invariants["device-limit"].rule: "{window}" names no value of "device-limit": declare it under its values, or write the text without braces',
      ),
      problem(
        'invariants["device-limit"].rule: "{}" names no value of "device-limit": declare it under its values, or write the text without braces',
      ),
      problem(
        'invariants["device-limit"].values.spare: the rule of "device-limit" never names it: write "{spare}" where the rule states it',
      ),
    ])
  })
  it('refuses a brace outside a placeholder, and two values that name one constant, at their place', () => {
    expect(
      invariantsProblems(
        signingIn(
          { 'device-limit': { invariant: 'device-limit' } },
          {
            'device-limit': {
              rule: '{{limit}} devices within {window}, {windowMs} } ms.',
              refuses: 'device-limit',
              values: { limit: 10, window: { minutes: 15 }, windowMs: 900_000 },
            },
          },
        ),
      ),
    ).toEqual([
      problem(
        'invariants["device-limit"].rule: a brace that is no placeholder: write each value as "{name}", and the rest without braces',
      ),
      problem(
        'invariants["device-limit"].values.windowMs: "window" and "windowMs" of "device-limit" are both emitted as "windowMs": rename one',
      ),
    ])
  })
  it('refuses a placeholder in the rule of an invariant with no values', () => {
    expect(
      invariantsProblems(
        signingIn(
          { 'device-limit': { invariant: 'device-limit' } },
          { 'device-limit': { rule: '{limit} devices at most.', refuses: 'device-limit' } },
        ),
      ),
    ).toEqual([
      problem(
        'invariants["device-limit"].rule: "{limit}" names no value of "device-limit": declare it under its values, or write the text without braces',
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
