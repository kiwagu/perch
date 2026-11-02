import { describe, expect, it } from 'vitest'

import { isSearch, searchOf } from './navigate-search'

const EMAIL = 'user.sign-in.email-input'

describe('the search of a move', () => {
  it('takes each literal as it is and each field as its event carries it', () => {
    expect(
      searchOf(
        { email: { anchor: EMAIL }, view: 'read', page: 2, open: true },
        { [EMAIL]: 'ann@example.test' },
      ),
    ).toEqual({ email: 'ann@example.test', view: 'read', page: 2, open: true })
  })

  it('leaves an empty field out of the address', () => {
    expect(searchOf({ email: { anchor: EMAIL }, view: 'read' }, { [EMAIL]: '' })).toEqual({
      view: 'read',
    })
  })

  it('never guesses a field its event does not carry', () => {
    expect(() => searchOf({ email: { anchor: EMAIL } }, {})).toThrow(EMAIL)
  })

  it('reads a search of literals and fields, and nothing else', () => {
    expect(isSearch({ email: { anchor: EMAIL }, view: 'read', page: 1 })).toBe(true)
    expect(isSearch({ email: { field: EMAIL } })).toBe(false)
    expect(isSearch({ list: ['a'] })).toBe(false)
    expect(isSearch('email')).toBe(false)
  })
})
