import { describe, expect, it } from 'vitest'

import { fieldAsserts, tableIndexes } from './table-constraints'

describe('fieldAsserts', () => {
  it('keys each assert by its field name and leaves out a field without one', () => {
    expect(
      fieldAsserts([
        { name: 'name', assert: 'string::len($value) > 0' },
        { name: 'email' },
        { name: 'address' },
        { name: 'address.city', assert: 'string::len($value) > 1' },
      ]),
    ).toEqual({
      name: 'string::len($value) > 0',
      'address.city': 'string::len($value) > 1',
    })
  })

  it('is empty for a table without asserts', () => {
    expect(fieldAsserts([{ name: 'email' }])).toEqual({})
    expect(fieldAsserts([])).toEqual({})
  })
})

describe('tableIndexes', () => {
  it('keeps the fields of each index in order and marks only a UNIQUE one', () => {
    expect(
      tableIndexes([
        { name: 'by_tenant', cols: ['tenant'], index: '' },
        { name: 'by_identity_tenant', cols: ['identity', 'tenant'], index: 'UNIQUE' },
      ]),
    ).toEqual({
      by_tenant: { fields: ['tenant'], unique: false },
      by_identity_tenant: { fields: ['identity', 'tenant'], unique: true },
    })
  })

  it('does not take a search index for a unique one', () => {
    expect(
      tableIndexes([
        { name: 'by_body', cols: ['body'], index: 'FULLTEXT ANALYZER an BM25(1.2,0.75)' },
      ]),
    ).toEqual({ by_body: { fields: ['body'], unique: false } })
  })

  it('is empty for a table without indexes', () => {
    expect(tableIndexes([])).toEqual({})
  })
})
