import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { readSchema } from '@workspace/data/testing'

import { loadSchemaModel, parseStructure, type StructureInfo } from './schema-structure'

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/info-structure.json', import.meta.url), 'utf8'),
) as StructureInfo
const schemaText = readSchema('directory')

describe('parseStructure', () => {
  const { model, problems } = parseStructure(fixture, schemaText)

  it('reads field types from the database structure', () => {
    expect(model.tables['identity']?.fields['email']).toEqual({ kind: 'scalar', name: 'string' })
    expect(model.tables['identity']?.fields['password']).toEqual({ kind: 'scalar', name: 'string' })
    expect(model.tables['identity']?.fields['created_at']).toEqual({
      kind: 'scalar',
      name: 'datetime',
    })
    expect(model.tables['profile']?.fields['identity']).toEqual({
      kind: 'record',
      tables: ['identity'],
    })
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
    expect(model.tables['identity']).toMatchObject({ replicate: 'none', idPrefix: 'idn' })
    expect(model.tables['_replica_update']).toMatchObject({ replicate: 'none' })
    expect(problems).toEqual([])
  })

  it('reads relations and nested object fields', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'shelf', kind: { kind: 'NORMAL' } },
          { name: 'keeps', kind: { kind: 'RELATION', in: ['identity'], out: ['shelf'] } },
        ],
      },
      tables: {
        shelf: {
          fields: [
            { name: 'address', kind: 'none | object' },
            { name: 'address.city', kind: 'string' },
            { name: 'tags', kind: 'array<string>' },
            { name: 'tags.*', kind: 'string' },
          ],
        },
        keeps: { fields: [{ name: 'side', kind: "'front' | 'back'" }] },
      },
    }
    const text =
      '-- @region tenant\n-- @id shf\nDEFINE TABLE shelf;\n-- @region tenant\n-- @id kep\nDEFINE TABLE keeps TYPE RELATION;'
    const parsed = parseStructure(info, text).model

    expect(parsed.tables['keeps']?.relation).toEqual({ in: ['identity'], out: ['shelf'] })
    expect(parsed.tables['shelf']?.fields).toEqual({
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
      'table a: declare exactly one of -- @region <private|public|tenant> or -- @replicate none',
      'table b: field n is int, a @crdt text field must be a string',
      'table c: a replicated table needs -- @id <prefix>',
    ])
  })

  it('accepts the tenant region and refuses a region it does not know', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'note', kind: { kind: 'NORMAL' } },
          { name: 'memo', kind: { kind: 'NORMAL' } },
        ],
      },
      tables: { note: { fields: [] }, memo: { fields: [] } },
    }
    const text = [
      '-- @region tenant',
      '-- @id nte',
      'DEFINE TABLE note;',
      '-- @region org',
      '-- @id mem',
      'DEFINE TABLE memo;',
    ].join('\n')
    const parsed = parseStructure(info, text)

    expect(parsed.model.tables['note']).toMatchObject({ region: 'tenant', idPrefix: 'nte' })
    expect(parsed.problems).toEqual(['table memo: unknown region org'])
  })
})

describe('loadSchemaModel', () => {
  it('applies the schema to an embedded database and reads it back', async () => {
    const { model, problems } = (await loadSchemaModel(schemaText))._unsafeUnwrap()

    expect(Object.keys(model.tables).sort()).toEqual([
      '_replica_cursor',
      '_replica_head',
      '_replica_outbox',
      '_replica_peer',
      '_replica_projected',
      '_replica_snapshot',
      '_replica_update',
      'device_session',
      'identity',
      'membership',
      'profile',
      'tenant',
    ])
    expect(model.tables['profile']?.region).toBe('private')
    expect(model.tables['tenant']).toMatchObject({ replicate: 'none', idPrefix: 'tnt' })
    expect(problems).toEqual([])
  })

  it('reads the tenant database with its notes in the tenant region', async () => {
    const { model, problems } = (await loadSchemaModel(readSchema('tenant')))._unsafeUnwrap()

    expect(model.tables['note']).toMatchObject({
      region: 'tenant',
      idPrefix: 'nte',
      crdt: { text: 'text' },
    })
    expect(model.tables['member']).toMatchObject({ replicate: 'none' })
    expect(model.tables['identity']).toBeUndefined()
    expect(problems).toEqual([])
  })

  it('reads the owner and the abilities of a table', () => {
    const info: StructureInfo = {
      db: { tables: [{ name: 'note', kind: { kind: 'NORMAL' } }] },
      tables: {
        note: {
          fields: [
            { name: 'author', kind: 'record<member>' },
            { name: 'text', kind: 'string' },
          ],
        },
      },
    }
    const text = [
      '-- @region tenant',
      '-- @id nte',
      '-- @owner author',
      '-- @can member create, update:own, delete:own',
      '-- @can admin create, update, delete',
      'DEFINE TABLE OVERWRITE note SCHEMAFULL PERMISSIONS NONE;',
    ].join('\n')

    const { model, problems } = parseStructure(info, text)

    expect(problems).toEqual([])
    expect(model.tables['note']?.abilities).toEqual({
      owner: 'author',
      can: {
        member: { create: 'any', update: 'own', delete: 'own' },
        admin: { create: 'any', update: 'any', delete: 'any' },
      },
    })
  })

  it('refuses owner and can annotations on a table outside the tenant region', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'profile', kind: { kind: 'NORMAL' } },
          { name: 'page', kind: { kind: 'NORMAL' } },
        ],
      },
      tables: {
        profile: { fields: [{ name: 'identity', kind: 'record<identity>' }] },
        page: { fields: [{ name: 'author', kind: 'record<member>' }] },
      },
    }
    const text = [
      '-- @region private',
      '-- @id prf',
      '-- @can member update',
      'DEFINE TABLE OVERWRITE profile SCHEMAFULL;',
      '-- @region public',
      '-- @id pag',
      '-- @owner author',
      '-- @can admin create',
      'DEFINE TABLE OVERWRITE page SCHEMAFULL;',
    ].join('\n')

    const { model, problems } = parseStructure(info, text)

    expect(problems).toEqual([
      'table profile: @owner and @can belong to a tenant table; private tables declare none',
      'table page: @owner and @can belong to a tenant table; public tables declare none',
    ])
    expect(model.tables['profile']?.abilities).toBeUndefined()
    expect(model.tables['page']?.abilities).toBeUndefined()
  })

  it('reports abilities that are wrong', () => {
    const info: StructureInfo = {
      db: {
        tables: [
          { name: 'note', kind: { kind: 'NORMAL' } },
          { name: 'member', kind: { kind: 'NORMAL' } },
        ],
      },
      tables: { note: { fields: [{ name: 'text', kind: 'string' }] }, member: { fields: [] } },
    }
    const text = [
      '-- @region tenant',
      '-- @id nte',
      '-- @owner text',
      '-- @can owner create',
      '-- @can member create:own, update:own, fly',
      '-- @can member delete',
      'DEFINE TABLE OVERWRITE note SCHEMAFULL;',
      '-- @replicate none',
      '-- @can admin create',
      'DEFINE TABLE OVERWRITE member SCHEMAFULL;',
    ].join('\n')

    expect(parseStructure(info, text).problems).toEqual([
      'table note: -- @owner text must name a record<member> field',
      'table note: -- @can needs "<member|admin> <action>[:own], …", got "owner create"',
      'table note: -- @can member: create:own is not allowed, a created record is owned by its author',
      'table note: -- @can member: unknown action "fly"',
      'table note: -- @can member is declared twice',
      'table member: @owner and @can belong to a replicated table, not to -- @replicate none',
    ])
  })
})
