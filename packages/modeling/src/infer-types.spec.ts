import { describe, expect, it } from 'vitest'

import { inferResultType, tablesOf } from './infer-types'
import type { SchemaModel } from './schema-structure'
import { parseShape } from './shape-dialect'
import type { FieldType } from './type-string'

const S = (name: 'string' | 'datetime' | 'int'): FieldType => ({ kind: 'scalar', name })

const schema: SchemaModel = {
  tables: {
    user: {
      idPrefix: 'usr',
      fields: {
        name: S('string'),
        email: S('string'),
        created_at: S('datetime'),
        avatar_url: { kind: 'option', inner: S('string') },
        manager: { kind: 'record', tables: ['user'] },
      },
    },
    org: { idPrefix: 'org', fields: { name: S('string'), size: S('int') } },
    member_of: { fields: { role: S('string') }, relation: { in: ['user'], out: ['org'] } },
  },
}

const user = [{ name: 'id', type: 'record<user>' }]

describe('inferResultType', () => {
  it('infers a flat projection on FROM ONLY $id: record<user>', () => {
    const ast = parseShape('SELECT name, email FROM ONLY $id;')

    expect(inferResultType(ast, user, schema)).toBe('{ name: string; email: string } | undefined')
  })

  it('types ids, datetimes and optional fields', () => {
    const ast = parseShape('SELECT id, created_at, avatar_url FROM ONLY $id;')

    expect(inferResultType(ast, user, schema)).toBe(
      '{ id: UserId; created_at: Date; avatar_url?: string | undefined } | undefined',
    )
  })

  it('infers arrays for graph edges and nested destructuring', () => {
    const ast = parseShape('SELECT ->member_of->org.{ id, name } AS orgs FROM ONLY $id;')

    expect(inferResultType(ast, user, schema)).toBe(
      '{ orgs: Array<{ id: OrgId; name: string }> } | undefined',
    )
  })

  it('types an edge without destructuring as ids and an incoming edge as edge records', () => {
    const ast = parseShape(
      'SELECT ->member_of->org AS orgs, <-member_of.{ role } AS memberships FROM ONLY $id;',
    )

    expect(inferResultType(ast, [{ name: 'id', type: 'record<org>' }], schema)).toBe(
      '{ orgs: Array<OrgId>; memberships: Array<{ role: string }> } | undefined',
    )
  })

  it('follows record links through field paths', () => {
    const ast = parseShape(
      'SELECT manager, manager.name AS manager_name, manager.{ email } AS boss FROM ONLY $id;',
    )

    expect(inferResultType(ast, user, schema)).toBe(
      '{ manager: UserId; manager_name: string; boss: { email: string } } | undefined',
    )
  })

  it('wraps FROM table (not ONLY) into an array', () => {
    const ast = parseShape('SELECT name FROM user;')

    expect(inferResultType(ast, [], schema)).toBe('Array<{ name: string }>')
  })

  it('fails on an unknown field or table', () => {
    expect(() =>
      inferResultType(parseShape('SELECT nickname FROM ONLY $id;'), user, schema),
    ).toThrow(/user has no field nickname/)
    expect(() => inferResultType(parseShape('SELECT name FROM team;'), [], schema)).toThrow(
      /unknown table team/,
    )
  })
})

describe('tablesOf', () => {
  it('lists the tables a shape reads, in a stable order', () => {
    const ast = parseShape(
      'SELECT name, email, ->member_of->org.{ id, name } AS orgs, manager.name AS m FROM ONLY $id;',
    )

    expect(tablesOf(ast, user, schema)).toEqual(['user', 'member_of', 'org'])
  })

  it('counts the tables a predicate, an ordering or a FETCH reads through record links', () => {
    const owner = [{ name: 'owner', type: 'record<user>' }]

    expect(
      tablesOf(parseShape('SELECT role FROM member_of WHERE in.manager.name = $name;'), [], schema),
    ).toEqual(['member_of', 'user'])
    expect(
      tablesOf(
        parseShape('SELECT role FROM member_of ORDER BY out.name DESC LIMIT 10;'),
        [],
        schema,
      ),
    ).toEqual(['member_of', 'org'])
    expect(
      tablesOf(
        parseShape('SELECT role FROM member_of WHERE $owner.manager.name = "Ann";'),
        owner,
        schema,
      ),
    ).toEqual(['member_of', 'user'])
    expect(tablesOf(parseShape('SELECT role FROM member_of FETCH out;'), [], schema)).toEqual([
      'member_of',
      'org',
    ])
    expect(tablesOf(parseShape('SELECT in FROM member_of FETCH in, out;'), [], schema)).toEqual([
      'member_of',
      'user',
      'org',
    ])
  })

  it('refuses a tail whose reads it cannot determine', () => {
    const tail = (rest: string) => () =>
      tablesOf(parseShape(`SELECT name FROM org ${rest};`), [], schema)

    expect(tail('WHERE id IN (SELECT VALUE out FROM member_of)')).toThrow(/subquer/)
    expect(tail('WHERE <-member_of<-user.name CONTAINS "Ann"')).toThrow(/graph/)
    expect(tail('WHERE fn::visible(id)')).toThrow(/fn::visible/)
    expect(tail('WHERE nmae = "x"')).toThrow('org has no field nmae')
  })
})
