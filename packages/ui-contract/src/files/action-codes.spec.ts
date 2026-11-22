import { describe, expect, it } from 'vitest'

import { codeEntriesOf, codeNamesOf, outcomesOf } from './action-codes'

const MAP = {
  'invalid-credentials': 'the email or the password is wrong',
  'device-limit': { invariant: 'device-limit' },
  failed: 'anything else fails',
}

describe('codeNamesOf', () => {
  it('reads the codes of a map in its order', () => {
    expect(codeNamesOf(MAP)).toEqual(['invalid-credentials', 'device-limit', 'failed'])
  })
  it('reads the codes of the older list as written', () => {
    expect(codeNamesOf(['rate-limited', 'failed'])).toEqual(['rate-limited', 'failed'])
  })
})

describe('codeEntriesOf', () => {
  it('gives each code of a map its key, its condition or its invariant', () => {
    expect(codeEntriesOf(MAP)).toEqual([
      {
        code: 'invalid-credentials',
        at: 'invalid-credentials',
        condition: 'the email or the password is wrong',
        invariants: [],
      },
      { code: 'device-limit', at: 'device-limit', invariants: ['device-limit'] },
      { code: 'failed', at: 'failed', condition: 'anything else fails', invariants: [] },
    ])
  })
  it('gives each code of the older list its index and nothing more', () => {
    expect(codeEntriesOf(['rate-limited', 'failed'])).toEqual([
      { code: 'rate-limited', at: 0, invariants: [] },
      { code: 'failed', at: 1, invariants: [] },
    ])
  })
})

describe('codeEntriesOf a code naming several invariants', () => {
  it('gives the names in order, with the condition written beside them', () => {
    expect(
      codeEntriesOf({
        'rate-limited': {
          invariant: ['failed-sign-ins', 'address-mails'],
          condition: 'a fourth change within a quarter of an hour',
        },
        'device-limit': { invariant: 'device-limit' },
      }),
    ).toEqual([
      {
        code: 'rate-limited',
        at: 'rate-limited',
        invariants: ['failed-sign-ins', 'address-mails'],
        condition: 'a fourth change within a quarter of an hour',
      },
      { code: 'device-limit', at: 'device-limit', invariants: ['device-limit'] },
    ])
  })
})

describe('outcomesOf', () => {
  it('reads one outcome as a list of one', () => {
    expect(outcomesOf('the device is signed in')).toEqual(['the device is signed in'])
  })
  it('reads a list of outcome lines as written', () => {
    expect(outcomesOf(['signed in', 'with the second factor on: asks for a code'])).toEqual([
      'signed in',
      'with the second factor on: asks for a code',
    ])
  })
})
