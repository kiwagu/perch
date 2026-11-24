import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkSecondFactorCode } from './second-factor-code.rule'

/** The fewest and the most characters a code of the second factor has, as the contract says it. */
const { minLength: MIN, maxLength: MAX } = CONTRACT_VALUES['second-factor-code']

describe('checkSecondFactorCode', () => {
  it('takes a code of any length the contract allows, as typed: an authenticator code and a backup code alike', () => {
    expect(checkSecondFactorCode('123456')._unsafeUnwrap()).toBe('123456')
    expect(checkSecondFactorCode('0123456789a')._unsafeUnwrap()).toBe('0123456789a')
    expect(checkSecondFactorCode('x'.repeat(MIN)).isOk()).toBe(true)
    expect(checkSecondFactorCode('x'.repeat(MAX)).isOk()).toBe(true)
  })

  it('leaves what the code is to the gateway: no trimming, no look at its characters', () => {
    expect(checkSecondFactorCode(' 12345 ')._unsafeUnwrap()).toBe(' 12345 ')
    expect(checkSecondFactorCode('abc-def-ghi')._unsafeUnwrap()).toBe('abc-def-ghi')
  })

  it.each([
    ['nothing', ''],
    ['five digits', '12345'],
    ['one character short', 'x'.repeat(MIN - 1)],
    ['one character too many', 'x'.repeat(MAX + 1)],
  ])('refuses %s as no code at all', (_, code) => {
    expect(checkSecondFactorCode(code)._unsafeUnwrapErr()).toEqual([
      { code: 'sign-in:CODE_INVALID' },
    ])
  })
})
