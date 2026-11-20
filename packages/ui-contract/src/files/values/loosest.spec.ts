import { describe, expect, it } from 'vitest'

import type { ResolvedValue } from './keywords'
import { loosest } from './loosest'
import { EMAIL, NEW_PASSWORD, PASSWORD } from './values.fixture'

/** A value a caller holds read-only: each property readonly, its enum a readonly array. */
const HELD: { readonly type: string; readonly enum: readonly (string | number)[] } = {
  type: 'string',
  enum: ['a', 1],
}

describe('loosest', () => {
  it('keeps the smallest least length, and a bound only when every value has one', () => {
    expect(
      loosest([{ minLength: 1 }, { minLength: 10, maxLength: 35, pattern: '^[!-~]+$' }]),
    ).toStrictEqual({ minLength: 1 })
    expect(loosest([PASSWORD, NEW_PASSWORD])).toStrictEqual({ type: 'string', minLength: 1 })
  })
  it('gives two equal values that value', () => {
    expect(loosest([EMAIL, { ...EMAIL }])).toStrictEqual(EMAIL)
  })
  it('drops a bound one value lacks', () => {
    expect(loosest([{ type: 'string', maxLength: 254 }, { type: 'string' }])).toStrictEqual({
      type: 'string',
    })
  })
  it('keeps the largest greatest length, the smallest minimum and the largest maximum', () => {
    expect(
      loosest([
        { maxLength: 80, minimum: 1, maximum: 10 },
        { maxLength: 254, minimum: 0, maximum: 5 },
      ]),
    ).toStrictEqual({ maxLength: 254, minimum: 0, maximum: 10 })
  })
  it('keeps a type, a pattern, a format and an enum only when every value has the same', () => {
    expect(
      loosest([
        { type: 'string', pattern: '^a', format: 'email', enum: ['a', 'b'] },
        { type: 'number', pattern: '^b', enum: ['a'] },
      ]),
    ).toStrictEqual({})
    expect(loosest([{ enum: ['a', 'b'] }, { enum: ['a', 'b'] }])).toStrictEqual({
      enum: ['a', 'b'],
    })
  })
  it('keeps readOnly only when every value has it', () => {
    expect(loosest([{ readOnly: true }, { readOnly: true }])).toStrictEqual({ readOnly: true })
    expect(loosest([{ readOnly: true }, {}])).toStrictEqual({})
  })
  it('gives no value no constraint, and one value itself', () => {
    expect(loosest([])).toStrictEqual({})
    expect(loosest([NEW_PASSWORD])).toStrictEqual(NEW_PASSWORD)
  })
  it('takes values a caller holds read-only, a readonly enum among them', () => {
    const kept: ResolvedValue = loosest([HELD, HELD])

    expect(kept).toStrictEqual({ type: 'string', enum: ['a', 1] })
  })
})
