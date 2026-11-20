import { describe, expect, it } from 'vitest'

import { readAssert } from './assert-limits'

const LENGTH = 'string::len($value) > 0 AND string::len($value) <= 80'

describe('readAssert', () => {
  it('reads the limits of an assert whose bounds are numbers, and lists those above as literal', () => {
    expect(readAssert(LENGTH, {})).toEqual({
      limits: { min: 1, max: 80, email: false, unread: [] },
      params: [],
      literalMaxima: [80],
    })
  })

  it('reads a bound written as a parameter for the number the schema holds, and names it', () => {
    expect(
      readAssert('string::len($value) > 0 AND string::len($value) <= $shelf_max_length', {
        shelf_max_length: '60',
      }),
    ).toEqual({
      limits: { min: 1, max: 60, email: false, unread: [] },
      params: ['shelf_max_length'],
      literalMaxima: [],
    })
  })

  it('names a parameter the schema does not define and leaves its clause unread', () => {
    expect(readAssert('string::len($value) <= $shelf_max_length', {})).toEqual({
      limits: { email: false, unread: ['string::len($value) <= $shelf_max_length'] },
      params: ['shelf_max_length'],
      literalMaxima: [],
    })
  })

  it('leaves unread a parameter whose value is no whole number', () => {
    expect(
      readAssert('string::len($value) <= $shelf_max_length', { shelf_max_length: "'sixty'" }).limits
        .unread,
    ).toEqual(['string::len($value) <= $shelf_max_length'])
  })

  it('lists every literal upper bound, whatever its operator', () => {
    expect(readAssert('string::len($value) < 81', {}).literalMaxima).toEqual([81])
    expect(readAssert('string::len($value) = 8', {}).literalMaxima).toEqual([8])
    expect(readAssert('string::len($value) >= 3', {}).literalMaxima).toEqual([])
  })

  it('reads the guard of an optional field as no limit and its bound as written', () => {
    expect(readAssert('$value = NONE OR string::len($value) <= 2000', {})).toEqual({
      limits: { max: 2000, email: false, unread: [] },
      params: [],
      literalMaxima: [2000],
    })
  })

  it('reads an assert that is none as no limit', () => {
    expect(readAssert(undefined, {})).toEqual({
      limits: { email: false, unread: [] },
      params: [],
      literalMaxima: [],
    })
  })

  it('reads the format, the pattern and the members as the database prints them', () => {
    expect(
      readAssert(`string::is_email($value) AND string::matches($value, '^[a-z]+$')`, {}).limits,
    ).toEqual({ email: true, pattern: '^[a-z]+$', unread: [] })
    expect(readAssert(`$value INSIDE ['b', 'a']`, {}).limits).toEqual({
      email: false,
      members: ['a', 'b'],
      unread: [],
    })
  })
})
