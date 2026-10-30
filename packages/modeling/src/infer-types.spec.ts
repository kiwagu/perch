import { describe, expect, it } from 'vitest'

import { inferResultType, tablesOf } from './infer-types'
import type { SchemaModel } from './schema-structure'
import { parseShape } from './shape-dialect'
import type { FieldType } from './type-string'

const S = (name: 'string' | 'datetime' | 'int'): FieldType => ({ kind: 'scalar', name })

const schema: SchemaModel = {
  tables: {
    identity: {
      idPrefix: 'idn',
      fields: {
        name: S('string'),
        email: S('string'),
        created_at: S('datetime'),
        avatar_url: { kind: 'option', inner: S('string') },
        manager: { kind: 'record', tables: ['identity'] },
      },
    },
    tenant: { idPrefix: 'tnt', fields: { name: S('string'), size: S('int') } },
    member_of: {
      fields: { role: S('string') },
      relation: { in: ['identity'], out: ['tenant'] },
    },
  },
}

const identity = [{ name: 'id', type: 'record<identity>' }]

describe('inferResultType', () => {
  it('infers a flat projection on FROM ONLY $id: record<identity>', () => {
    const ast = parseShape('SELECT name, email FROM ONLY $id;')

    expect(inferResultType(ast, identity, schema)).toBe(
      '{ name: string; email: string } | undefined',
    )
  })

  it('types ids, datetimes and optional fields', () => {
    const ast = parseShape('SELECT id, created_at, avatar_url FROM ONLY $id;')

    expect(inferResultType(ast, identity, schema)).toBe(
      '{ id: IdentityId; created_at: Date; avatar_url?: string | undefined } | undefined',
    )
  })

  it('infers arrays for graph edges and nested destructuring', () => {
    const ast = parseShape('SELECT ->member_of->tenant.{ id, name } AS tenants FROM ONLY $id;')

    expect(inferResultType(ast, identity, schema)).toBe(
      '{ tenants: Array<{ id: TenantId; name: string }> } | undefined',
    )
  })

  it('types an edge without destructuring as ids and an incoming edge as edge records', () => {
    const ast = parseShape(
      'SELECT ->member_of->tenant AS tenants, <-member_of.{ role } AS memberships FROM ONLY $id;',
    )

    expect(inferResultType(ast, [{ name: 'id', type: 'record<tenant>' }], schema)).toBe(
      '{ tenants: Array<TenantId>; memberships: Array<{ role: string }> } | undefined',
    )
  })

  it('follows record links through field paths', () => {
    const ast = parseShape(
      'SELECT manager, manager.name AS manager_name, manager.{ email } AS boss FROM ONLY $id;',
    )

    expect(inferResultType(ast, identity, schema)).toBe(
      '{ manager: IdentityId; manager_name: string; boss: { email: string } } | undefined',
    )
  })

  it('wraps FROM table (not ONLY) into an array', () => {
    const ast = parseShape('SELECT name FROM identity;')

    expect(inferResultType(ast, [], schema)).toBe('Array<{ name: string }>')
  })

  it('fails on an unknown field or table', () => {
    expect(() =>
      inferResultType(parseShape('SELECT nickname FROM ONLY $id;'), identity, schema),
    ).toThrow(/identity has no field nickname/)
    expect(() => inferResultType(parseShape('SELECT name FROM team;'), [], schema)).toThrow(
      /unknown table team/,
    )
  })
})

describe('tablesOf', () => {
  it('lists the tables a shape reads, in a stable order', () => {
    const ast = parseShape(
      'SELECT name, email, ->member_of->tenant.{ id, name } AS tenants, manager.name AS m FROM ONLY $id;',
    )

    expect(tablesOf(ast, identity, schema)).toEqual(['identity', 'member_of', 'tenant'])
  })

  it('counts the tables a predicate, an ordering or a FETCH reads through record links', () => {
    const owner = [{ name: 'owner', type: 'record<identity>' }]

    expect(
      tablesOf(parseShape('SELECT role FROM member_of WHERE in.manager.name = $name;'), [], schema),
    ).toEqual(['member_of', 'identity'])
    expect(
      tablesOf(
        parseShape('SELECT role FROM member_of ORDER BY out.name DESC LIMIT 10;'),
        [],
        schema,
      ),
    ).toEqual(['member_of', 'tenant'])
    expect(
      tablesOf(
        parseShape('SELECT role FROM member_of WHERE $owner.manager.name = "Ann";'),
        owner,
        schema,
      ),
    ).toEqual(['member_of', 'identity'])
    expect(tablesOf(parseShape('SELECT role FROM member_of FETCH out;'), [], schema)).toEqual([
      'member_of',
      'tenant',
    ])
    expect(tablesOf(parseShape('SELECT in FROM member_of FETCH in, out;'), [], schema)).toEqual([
      'member_of',
      'identity',
      'tenant',
    ])
  })

  it('refuses a tail whose reads it cannot determine', () => {
    const tail = (rest: string) => () =>
      tablesOf(parseShape(`SELECT name FROM tenant ${rest};`), [], schema)

    expect(tail('WHERE id IN (SELECT VALUE out FROM member_of)')).toThrow(/subquer/)
    expect(tail('WHERE <-member_of<-identity.name CONTAINS "Ann"')).toThrow(/graph/)
    expect(tail('WHERE fn::visible(id)')).toThrow(/fn::visible/)
    expect(tail('WHERE nmae = "x"')).toThrow('tenant has no field nmae')
  })
})
