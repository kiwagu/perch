import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { readSchema } from '@workspace/data/testing'

import { loadSchemaModel, parseStructure, type StructureInfo } from './schema-structure'

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/info-structure.json', import.meta.url), 'utf8'),
) as StructureInfo
const schemaText = readSchema()

describe('parseStructure', () => {
  const { model, problems } = parseStructure(fixture, schemaText)

  it('reads field types from the database structure', () => {
    expect(model.tables['user']?.fields['email']).toEqual({ kind: 'scalar', name: 'string' })
    expect(model.tables['user']?.fields['password']).toEqual({ kind: 'scalar', name: 'string' })
    expect(model.tables['user']?.fields['created_at']).toEqual({ kind: 'scalar', name: 'datetime' })
    expect(model.tables['profile']?.fields['user']).toEqual({ kind: 'record', tables: ['user'] })
    expect(model.tables['profile']?.fields['bio']).toEqual({
      kind: 'option',
      inner: { kind: 'scalar', name: 'string' },
    })
  })

  it('reads the annotations from the schema text', () => {
    expect(model.tables['profile']).toMatchObject({
      region: 'private',
      idPrefix: 'prf',
      crdt: { bio: 'text' },
    })
    expect(model.tables['user']).toMatchObject({ replicate: 'none', idPrefix: 'usr' })
    expect(model.tables['_replica_update']).toMatchObject({ replicate: 'none' })
    expect(problems).toEqual([])
  })

  it('reads relations and nested object fields', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'org', kind: { kind: 'NORMAL' } },
          { name: 'member_of', kind: { kind: 'RELATION', in: ['user'], out: ['org'] } },
        ],
      },
      tables: {
        org: {
          fields: [
            { name: 'address', kind: 'none | object' },
            { name: 'address.city', kind: 'string' },
            { name: 'tags', kind: 'array<string>' },
            { name: 'tags.*', kind: 'string' },
          ],
        },
        member_of: { fields: [{ name: 'role', kind: "'member' | 'admin'" }] },
      },
    }
    const text =
      '-- @region org\n-- @id org\nDEFINE TABLE org;\n-- @region org\n-- @id mbr\nDEFINE TABLE member_of TYPE RELATION;'
    const parsed = parseStructure(info, text).model

    expect(parsed.tables['member_of']?.relation).toEqual({ in: ['user'], out: ['org'] })
    expect(parsed.tables['org']?.fields).toEqual({
      address: {
        kind: 'option',
        inner: { kind: 'object', fields: { city: { kind: 'scalar', name: 'string' } } },
      },
      tags: { kind: 'array', inner: { kind: 'scalar', name: 'string' } },
    })
  })

  it('reports tables and fields whose annotations are missing or wrong', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'a', kind: { kind: 'NORMAL' } },
          { name: 'b', kind: { kind: 'NORMAL' } },
          { name: 'c', kind: { kind: 'NORMAL' } },
        ],
      },
      tables: {
        a: { fields: [] },
        b: { fields: [{ name: 'n', kind: 'int' }] },
        c: { fields: [] },
      },
    }
    const text = [
      'DEFINE TABLE a;',
      '-- @region private',
      '-- @id bbb',
      'DEFINE TABLE b;',
      '-- @crdt text',
      'DEFINE FIELD n ON b TYPE int;',
      '-- @region private',
      'DEFINE TABLE c;',
    ].join('\n')

    expect(parseStructure(info, text).problems).toEqual([
      'table a: declare exactly one of -- @region <private|public|org> or -- @replicate none',
      'table b: field n is int, a @crdt text field must be a string',
      'table c: a replicated table needs -- @id <prefix>',
    ])
  })
})

describe('loadSchemaModel', () => {
  it('applies the schema to an embedded database and reads it back', async () => {
    const { model, problems } = (await loadSchemaModel(schemaText))._unsafeUnwrap()

    expect(Object.keys(model.tables).sort()).toEqual([
      '_replica_outbox',
      '_replica_projected',
      '_replica_snapshot',
      '_replica_update',
      'profile',
      'user',
    ])
    expect(model.tables['profile']?.region).toBe('private')
    expect(problems).toEqual([])
  })
})
