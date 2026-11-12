import { describe, expect, it } from 'vitest'

import { entityDefinitionSchema } from './entity.schema'

/** An entity of the model with one action, `createThing`, written as `action`. */
const entityWith = (action: Record<string, unknown>) => ({
  type: 'object',
  'x-perch': { table: 'thing', region: 'tenant', id: 'thg', actions: { createThing: action } },
  properties: { id: { type: 'string', 'x-perch': { readonly: true } } },
  required: ['id'],
  additionalProperties: false,
})

describe('entityDefinitionSchema changes', () => {
  it('accepts an action that names the reads it changes, or none', () => {
    for (const changes of [['things.list'], []]) {
      expect(
        entityDefinitionSchema.safeParse(entityWith({ params: { id: '$id' }, changes })).success,
        JSON.stringify(changes),
      ).toBe(true)
    }
  })
  it('refuses an action that does not say what it changes, at its changes', () => {
    const parsed = entityDefinitionSchema.safeParse(entityWith({ params: { id: '$id' } }))

    expect(parsed.error?.issues.map(({ path }) => path)).toEqual([
      ['x-perch', 'actions', 'createThing', 'changes'],
    ])
  })
})
