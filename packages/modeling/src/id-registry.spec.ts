import { describe, expect, it } from 'vitest'

import { registry } from '@workspace/ids'

import { checkIdRegistry } from './id-registry'
import type { SchemaModel } from './schema-structure'

const table = (idPrefix?: string) => ({ fields: {}, ...(idPrefix ? { idPrefix } : {}) })

describe('checkIdRegistry', () => {
  it('accepts a schema whose @id prefixes match the registry both ways', () => {
    const schema: SchemaModel = {
      tables: {
        identity: table('idn'),
        profile: table('prf'),
        tenant: table('tnt'),
        membership: table('mbr'),
        device_session: table('dvs'),
        note: table('nte'),
        member: table(),
        _replica_update: table(),
      },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([])
  })

  it('reports a table whose prefix the registry does not know or names differently', () => {
    const schema: SchemaModel = {
      tables: {
        identity: table('idx'),
        profile: table('prf'),
        tenant: table('tnt'),
        membership: table('mbr'),
        device_session: table('dvs'),
        note: table('nte'),
        team: table('tem'),
      },
    }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'table identity declares -- @id idx but the id registry gives identity the prefix idn',
      'table team declares -- @id tem but the id registry has no kind team',
    ])
  })

  it('reports a registry kind without a table or without an @id on its table', () => {
    const schema: SchemaModel = { tables: { identity: table(), note: table() } }

    expect(checkIdRegistry(schema, registry.prefixes)).toEqual([
      'the id registry declares identity = idn but table identity has no -- @id idn',
      'the id registry declares profile = prf but the schema has no table profile',
      'the id registry declares tenant = tnt but the schema has no table tenant',
      'the id registry declares membership = mbr but the schema has no table membership',
      'the id registry declares device_session = dvs but the schema has no table device_session',
      'the id registry declares note = nte but table note has no -- @id nte',
    ])
  })
})
