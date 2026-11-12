import { describe, expect, it } from 'vitest'

import { isSearch, searchOf } from './navigate-search'

const EMAIL = 'user.sign-in.email-input'
const ITEM = 'console.users.list.account-item'

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

  it('takes an item as the id of the entry its event carries for it', () => {
    expect(searchOf({ id: { item: ITEM }, view: 'read' }, {}, { [ITEM]: 'idn_ann' })).toEqual({
      id: 'idn_ann',
      view: 'read',
    })
  })

  it('never guesses an item, nor leaves it out: one its event does not carry, or carries empty, throws', () => {
    expect(() => searchOf({ id: { item: ITEM } }, {})).toThrow(ITEM)
    expect(() => searchOf({ id: { item: ITEM } }, {}, { [ITEM]: '' })).toThrow(ITEM)
  })

  it('reads a search of literals, fields and items, and nothing else', () => {
    expect(isSearch({ email: { anchor: EMAIL }, view: 'read', page: 1 })).toBe(true)
    expect(isSearch({ id: { item: ITEM }, page: 1 })).toBe(true)
    expect(isSearch({ email: { field: EMAIL } })).toBe(false)
    expect(isSearch({ id: { item: 1 } })).toBe(false)
    expect(isSearch({ list: ['a'] })).toBe(false)
    expect(isSearch('email')).toBe(false)
  })
})
