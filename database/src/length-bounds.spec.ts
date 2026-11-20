import { describe, expect, it } from 'vitest'

import { lengthBoundProblems } from './length-bounds'

/** A schema of one table the values below are held to, by what each column's assert says. */
const bounded = (asserts: Readonly<Record<string, string>>) => new Map([['shelf', { asserts }]])

const VALUES = {
  'shelf.name': { type: 'string', minLength: 1, maxLength: 80 },
  'shelf-label': { type: 'string', maxLength: 60 },
  note: { type: 'string', minLength: 1 },
} as const

const PARAMS = { shelf_name_max_length: '80', shelf_label_max_length: '60' }

const NAME = 'string::len($value) > 0 AND string::len($value) <= $shelf_name_max_length'

const check = (input: {
  asserts: Record<string, string>
  params?: Record<string, string>
  literal?: string[]
}) =>
  lengthBoundProblems({
    tables: bounded(input.asserts),
    params: input.params ?? PARAMS,
    values: VALUES,
    literal: input.literal ?? [],
  })

describe('lengthBoundProblems', () => {
  it('finds none in a schema whose bounds name the parameters of values that hold them', () => {
    expect(
      check({ asserts: { name: NAME, label: 'string::len($value) <= $shelf_label_max_length' } }),
    ).toEqual([])
  })

  it('refuses a literal bound on a column that is not listed as holding no contract value', () => {
    expect(
      check({ asserts: { name: 'string::len($value) > 0 AND string::len($value) <= 80' } }),
    ).toEqual(['shelf.name writes the length bound 80: name the parameter of its contract value'])
  })

  it('refuses a literal bound whatever its operator', () => {
    expect(check({ asserts: { name: 'string::len($value) < 81' } })).toEqual([
      'shelf.name writes the length bound 81: name the parameter of its contract value',
    ])
  })

  it('allows a literal bound on a column the list names', () => {
    expect(
      check({ asserts: { code: 'string::len($value) <= 12' }, literal: ['shelf.code'] }),
    ).toEqual([])
  })

  it('refuses a listed column that writes no literal bound any more', () => {
    expect(
      check({
        asserts: { code: 'string::len($value) <= $shelf_label_max_length' },
        literal: ['shelf.code', 'shelf.gone'],
      }),
    ).toEqual([
      'shelf.code is listed as a literal bound but writes none',
      'shelf.gone is listed as a literal bound but writes none',
    ])
  })

  it('leaves the lower bounds literal', () => {
    expect(check({ asserts: { name: 'string::len($value) > 0' } })).toEqual([])
  })

  it('refuses a parameter the schema does not define', () => {
    expect(
      check({ asserts: { name: 'string::len($value) <= $shelf_name_max_length' }, params: {} }),
    ).toEqual(['shelf.name names $shelf_name_max_length, which the schema does not define'])
  })

  it('refuses a parameter that backs no contract value with a limit', () => {
    expect(
      check({
        asserts: { name: 'string::len($value) <= $note_max_length' },
        params: { note_max_length: '10' },
      }),
    ).toEqual(['shelf.name names $note_max_length, which backs no contract value with a limit'])
  })

  it('refuses a parameter that holds another number than its value', () => {
    expect(
      check({
        asserts: { name: NAME },
        params: { ...PARAMS, shelf_name_max_length: '81' },
      }),
    ).toEqual(['$shelf_name_max_length holds 81, the contract value shelf.name has 80'])
  })

  it('says it once for a parameter that several columns name', () => {
    expect(
      check({
        asserts: { name: NAME, title: NAME },
        params: { ...PARAMS, shelf_name_max_length: '81' },
      }),
    ).toEqual(['$shelf_name_max_length holds 81, the contract value shelf.name has 80'])
  })
})
