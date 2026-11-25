import { describe, expect, it } from 'vitest'

import { schemaParams } from './schema-params'

describe('schemaParams', () => {
  it('keeps each parameter the schema defines with the value the database holds', () => {
    const text = [
      '-- A limit.',
      'DEFINE PARAM OVERWRITE $shelf_max_length VALUE 60;',
      'define param if not exists $rack_max_length value 12;',
      'DEFINE PARAM $crate_max_length VALUE 4;',
    ].join('\n')

    expect(
      schemaParams(
        [
          { name: 'crate_max_length', value: '4' },
          { name: 'rack_max_length', value: '12' },
          { name: 'shelf_max_length', value: '60' },
        ],
        text,
      ),
    ).toEqual({ crate_max_length: '4', rack_max_length: '12', shelf_max_length: '60' })
  })

  it('leaves out a parameter the schema text does not define', () => {
    const text = [
      '-- DEFINE PARAM OVERWRITE $shelf_max_length VALUE 60;',
      "DEFINE FIELD OVERWRITE note ON shelf TYPE string DEFAULT 'DEFINE PARAM $rack_max_length';",
    ].join('\n')

    expect(
      schemaParams(
        [
          { name: 'applied_schema', value: "'-- the schema text'" },
          { name: 'rack_max_length', value: '12' },
          { name: 'shelf_max_length', value: '60' },
        ],
        text,
      ),
    ).toEqual({})
  })

  it('is empty for a schema without parameters', () => {
    expect(schemaParams([{ name: 'applied_schema', value: "''" }], 'DEFINE TABLE shelf;')).toEqual(
      {},
    )
  })
})
