import { describe, expect, it } from 'vitest'

import { checkNoteText, NOTE_TEXT_MAX } from './note.entity'

describe('checkNoteText', () => {
  it('trims a text and keeps one of up to 500 characters', () => {
    expect(NOTE_TEXT_MAX).toBe(500)
    expect(checkNoteText('  Hello  ')._unsafeUnwrap()).toBe('Hello')
    expect(checkNoteText(` ${'x'.repeat(500)} `)._unsafeUnwrap()).toHaveLength(500)
  })

  it('refuses a text that is blank or longer than 500 characters', () => {
    expect(checkNoteText('   ')._unsafeUnwrapErr()).toEqual([{ code: 'note:TEXT_REQUIRED' }])
    expect(checkNoteText('x'.repeat(501))._unsafeUnwrapErr()).toEqual([
      { code: 'note:TEXT_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the database does', () => {
    expect(checkNoteText('\u{1F600}'.repeat(500)).isOk()).toBe(true)
    expect(checkNoteText('\u{1F600}'.repeat(501))._unsafeUnwrapErr()).toEqual([
      { code: 'note:TEXT_TOO_LONG' },
    ])
  })
})
