import { describe, expect, it } from 'vitest'

import { registry } from '@workspace/ids'

import { checkIdRegistry } from './id-registry'
import type { SchemaModel } from './schema-structure'

const table = (idPrefix?: string) => ({ fields: {}, ...(idPrefix ? { idPrefix } : {}) })

describe('checkIdRegistry', () => {
  it('accepts a schema whose @id prefixes match the registry both ways', () => {
    const schema: SchemaModel = {
      tables: { user: table('usr'), profile: table('prf'), _replica_update: table() },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([])
  })

  it('reports a table whose prefix the registry does not know or names differently', () => {
    const schema: SchemaModel = {
      tables: { user: table('use'), profile: table('prf'), org: table('org') },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'table user declares -- @id use but the id registry gives user the prefix usr',
      'table org declares -- @id org but the id registry has no kind org',
    ])
  })

  it('reports a registry kind without a table or without an @id on its table', () => {
    const schema: SchemaModel = { tables: { user: table() } }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'the id registry declares user = usr but table user has no -- @id usr',
      'the id registry declares profile = prf but the schema has no table profile',
    ])
  })
})
