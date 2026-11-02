import { describe, expect, it } from 'vitest'

import { fieldOf, type ReplicaSchema, tablesOf } from './schema'

const schema: ReplicaSchema = {
  profile: {
    region: 'private',
    fields: { identity: { kind: 'record', table: 'identity' }, name: { kind: 'plain' } },
  },
  note: { region: 'public', fields: {} },
}

describe('replica schema', () => {
  it('finds a field of a replicated table', () => {
    expect(fieldOf(schema, 'profile', 'identity')).toEqual({ kind: 'record', table: 'identity' })
    expect(fieldOf(schema, 'profile', 'name')).toEqual({ kind: 'plain' })
    expect(fieldOf(schema, 'profile', 'nickname')).toBeUndefined()
  })

  it('finds no field or table under a name every object inherits', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(fieldOf(schema, 'profile', name)).toBeUndefined()
      expect(fieldOf(schema, name, 'fields')).toBeUndefined()
    }
  })

  it('lists the tables of a region', () => {
    expect(tablesOf(schema, 'private')).toEqual(['profile'])
    expect(tablesOf(schema, 'tenant')).toEqual([])
  })
})
