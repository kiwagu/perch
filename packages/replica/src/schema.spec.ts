import { describe, expect, it } from 'vitest'

import { fieldOf, type ReplicaSchema, tablesOf } from './schema'

const schema: ReplicaSchema = {
  profile: { region: 'private', fields: { identity: { kind: 'record', table: 'identity' } } },
  note: { region: 'public', fields: {} },
}

describe('replica schema', () => {
  it('finds a field of a replicated table', () => {
    expect(fieldOf(schema, 'profile', 'identity')).toEqual({ kind: 'record', table: 'identity' })
    expect(fieldOf(schema, 'profile', 'name')).toBeUndefined()
  })

  it('lists the tables of a region', () => {
    expect(tablesOf(schema, 'private')).toEqual(['profile'])
    expect(tablesOf(schema, 'tenant')).toEqual([])
  })
})
