import { describe, expect, it } from 'vitest'

import { textLength } from './text-length'

describe('textLength', () => {
  it('counts a text in characters', () => {
    expect(textLength('')).toBe(0)
    expect(textLength('Ann')).toBe(3)
    expect(textLength('Zo\u00eb')).toBe(3)
  })

  it('counts a character outside the basic plane once, as the gateway and the database count it', () => {
    expect(textLength('\u{1F600}')).toBe(1)
    expect(textLength('\u{1F600}'.repeat(80))).toBe(80)
    expect('\u{1F600}'.repeat(80)).toHaveLength(160)
  })

  it('counts each code point of a letter and its combining accent', () => {
    expect(textLength('e\u0301')).toBe(2)
  })
})
