import { describe, expect, it } from 'vitest'

import { registry } from '@workspace/ids'

import { checkIdRegistry } from './id-registry'
import type { SchemaModel } from './schema-structure'

const table = (idPrefix?: string) => ({ fields: {}, ...(idPrefix ? { idPrefix } : {}) })

describe('checkIdRegistry', () => {
  it('accepts a schema whose @id prefixes match the registry both ways', () => {
    const schema: SchemaModel = {
      tables: { identity: table('idn'), profile: table('prf'), _replica_update: table() },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([])
  })

  it('reports a table whose prefix the registry does not know or names differently', () => {
    const schema: SchemaModel = {
      tables: { identity: table('idx'), profile: table('prf'), org: table('org') },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'table identity declares -- @id idx but the id registry gives identity the prefix idn',
      'table org declares -- @id org but the id registry has no kind org',
    ])
  })

  it('reports a registry kind without a table or without an @id on its table', () => {
    const schema: SchemaModel = { tables: { identity: table() } }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'the id registry declares identity = idn but table identity has no -- @id idn',
      'the id registry declares profile = prf but the schema has no table profile',
    ])
  })
})
