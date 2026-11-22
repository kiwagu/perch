import { describe, expect, it } from 'vitest'

import { codeEntriesOf, codesOf, outcomesOf } from './action-codes'

const MAP = {
  'invalid-credentials': 'the email or the password is wrong',
  'device-limit': { invariant: 'device-limit' },
  failed: 'anything else fails',
}

describe('codesOf', () => {
  it('reads the codes of a map in its order', () => {
    expect(codesOf(MAP)).toEqual(['invalid-credentials', 'device-limit', 'failed'])
  })
  it('reads the codes of the older list as written', () => {
    expect(codesOf(['rate-limited', 'failed'])).toEqual(['rate-limited', 'failed'])
  })
})

describe('codeEntriesOf', () => {
  it('gives each code of a map its key, its condition or its invariant', () => {
    expect(codeEntriesOf(MAP)).toEqual([
      {
        code: 'invalid-credentials',
        at: 'invalid-credentials',
        condition: 'the email or the password is wrong',
      },
      { code: 'device-limit', at: 'device-limit', invariant: 'device-limit' },
      { code: 'failed', at: 'failed', condition: 'anything else fails' },
    ])
  })
  it('gives each code of the older list its index and nothing more', () => {
    expect(codeEntriesOf(['rate-limited', 'failed'])).toEqual([
      { code: 'rate-limited', at: 0 },
      { code: 'failed', at: 1 },
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
