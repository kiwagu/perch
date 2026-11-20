import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkNoteText } from './note.entity'

/** The most characters a note has, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['note.text']

describe('checkNoteText', () => {
  it('trims a text and keeps one up to the limit', () => {
    expect(checkNoteText('  Hello  ')._unsafeUnwrap()).toBe('Hello')
    expect(checkNoteText(` ${'x'.repeat(MAX)} `)._unsafeUnwrap()).toHaveLength(MAX)
  })

  it('refuses a text that is blank or longer than the limit', () => {
    expect(checkNoteText('   ')._unsafeUnwrapErr()).toEqual([{ code: 'note:TEXT_REQUIRED' }])
    expect(checkNoteText('x'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'note:TEXT_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the database does', () => {
    expect(checkNoteText('\u{1F600}'.repeat(MAX)).isOk()).toBe(true)
    expect(checkNoteText('\u{1F600}'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'note:TEXT_TOO_LONG' },
    ])
  })
})
