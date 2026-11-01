import { describe, expect, it } from 'vitest'

import {
  checkPasswordRules,
  keepsPasswordRules,
  PASSWORD_LENGTH,
  PASSWORD_RULES,
  PASSWORD_SYMBOLS,
} from './password-rules'

/** A password that keeps every rule, 12 characters long. */
const KEEPS_ALL = 'Abcdefghij1!'

/** A Cyrillic letter (zhe), written by its code point. */
const CYRILLIC_ZHE = String.fromCodePoint(0x0436)

/** The capital of `CYRILLIC_ZHE`. */
const CYRILLIC_CAPITAL_ZHE = String.fromCodePoint(0x0416)

/** Cyrillic letters that look like the Latin a, e and o, written by their code points. */
const CYRILLIC_A = String.fromCodePoint(0x0430)
const CYRILLIC_IE = String.fromCodePoint(0x0435)
const CYRILLIC_O = String.fromCodePoint(0x043e)

/** The Greek omicron, which looks like the Latin o. */
const GREEK_OMICRON = String.fromCodePoint(0x03bf)

/** A combining acute accent: after an `e` it reads as an accented e, typed as two characters. */
const COMBINING_ACUTE = String.fromCodePoint(0x0301)

/** A high surrogate on its own, with no low surrogate after it: no character at all. */
const LONE_SURROGATE = String.fromCharCode(0xd800)

/** A password of `length` characters that keeps every other rule. */
const ofLength = (length: number): string => `Ab1!${'c'.repeat(length - 4)}`

describe('the rules of a new password', () => {
  it('lists its rules in the order a form shows them', () => {
    expect(PASSWORD_RULES).toEqual([
      'length',
      'characters',
      'digit',
      'uppercase',
      'lowercase',
      'symbol',
    ])
    expect(PASSWORD_LENGTH).toEqual({ min: 10, max: 35 })
  })

  it('names the 32 printable ASCII symbols, each once', () => {
    expect([...PASSWORD_SYMBOLS]).toHaveLength(32)
    expect(new Set(PASSWORD_SYMBOLS).size).toBe(32)
    expect(PASSWORD_SYMBOLS).toBe('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')
  })

  it('keeps all of them with a letter of each case, a digit and a symbol, 10 to 35 characters', () => {
    expect(checkPasswordRules(KEEPS_ALL)).toEqual({
      length: true,
      characters: true,
      digit: true,
      uppercase: true,
      lowercase: true,
      symbol: true,
    })
    expect(keepsPasswordRules(KEEPS_ALL)).toBe(true)
  })

  it('keeps none of them with nothing typed', () => {
    expect(checkPasswordRules('')).toEqual({
      length: false,
      characters: false,
      digit: false,
      uppercase: false,
      lowercase: false,
      symbol: false,
    })
    expect(keepsPasswordRules('')).toBe(false)
  })

  it.each([
    [9, false],
    [10, true],
    [35, true],
    [36, false],
  ])('counts %i characters as keeping the length: %s', (length, kept) => {
    const password = ofLength(length)

    expect(password).toHaveLength(length)
    expect(checkPasswordRules(password)).toEqual({
      length: kept,
      characters: true,
      digit: true,
      uppercase: true,
      lowercase: true,
      symbol: true,
    })
    expect(keepsPasswordRules(password)).toBe(kept)
  })

  it.each([...PASSWORD_SYMBOLS])('takes %s as a symbol', (symbol) => {
    const password = `Abcdefghi1${symbol}`

    expect(checkPasswordRules(password)).toMatchObject({ characters: true, symbol: true })
    expect(keepsPasswordRules(password)).toBe(true)
  })

  it.each([
    ['a space', 'Abcdefg hij1!'],
    ['a tab', 'Abcdefg\thij1!'],
    ['a control character', 'Abcdefg\u0007hij1!'],
    ['a NUL character', 'Abcdefg\u0000hij1!'],
    ['a deletion character', 'Abcdefg\u007fhij1!'],
    ['an accented letter', 'Abcdefgéhij1!'],
    ['a Cyrillic letter', `Abcdefg${CYRILLIC_ZHE}hij1!`],
    ['an accent combined with a Latin letter', `Abcdefge${COMBINING_ACUTE}hij1!`],
    ['a Cyrillic a that looks Latin', `Abcdefg${CYRILLIC_A}hij1!`],
    ['a Cyrillic e that looks Latin', `Abcdefg${CYRILLIC_IE}hij1!`],
    ['a Cyrillic o that looks Latin', `Abcdefg${CYRILLIC_O}hij1!`],
    ['a Greek omicron that looks Latin', `Abcdefg${GREEK_OMICRON}hij1!`],
    ['a lone surrogate', `Abcdefg${LONE_SURROGATE}hij1!`],
    ['an emoji', 'Abcdefg\u{1F600}hij1!'],
  ])('breaks the characters rule with %s, and no other', (_, password) => {
    expect(checkPasswordRules(password)).toEqual({
      length: true,
      characters: false,
      digit: true,
      uppercase: true,
      lowercase: true,
      symbol: true,
    })
    expect(keepsPasswordRules(password)).toBe(false)
  })

  it('takes no space, accented letter or Cyrillic letter as a symbol or a letter', () => {
    expect(checkPasswordRules(` éÉ${CYRILLIC_ZHE}${CYRILLIC_CAPITAL_ZHE}`)).toMatchObject({
      characters: false,
      uppercase: false,
      lowercase: false,
      symbol: false,
    })
  })

  it('counts an emoji as one character', () => {
    expect(checkPasswordRules(`Ab1!cdefg\u{1F600}`).length).toBe(true)
    expect(checkPasswordRules(`Ab1!cdef\u{1F600}`).length).toBe(false)
  })

  it.each([
    ['digit', 'Abcdefghij!!'],
    ['uppercase', 'abcdefghij1!'],
    ['lowercase', 'ABCDEFGHIJ1!'],
    ['symbol', 'Abcdefghij12'],
  ] as const)('breaks the %s rule without one, and no other', (rule, password) => {
    const kept = checkPasswordRules(password)

    expect(PASSWORD_RULES.filter((each) => !kept[each])).toEqual([rule])
    expect(keepsPasswordRules(password)).toBe(false)
  })

  it('marks what a password typed so far keeps', () => {
    expect(checkPasswordRules('abcdefghij')).toEqual({
      length: true,
      characters: true,
      digit: false,
      uppercase: false,
      lowercase: true,
      symbol: false,
    })
  })
})
