import { describe, expect, it } from 'vitest'

import { parseShape } from './shape-dialect'

describe('parseShape', () => {
  it('parses fields, destructuring, aliases and graph edges', () => {
    const ast = parseShape(`SELECT name, email,
      ->member_of->tenant.{ id, name } AS tenants,
      <-member_of.{ role } AS roles,
      profile.{ bio, avatar: avatar_url }
    FROM ONLY $id;`)

    expect(ast.from).toEqual({ kind: 'param', name: 'id', only: true })
    expect(ast.projections.map((projection) => projection.name)).toEqual([
      'name',
      'email',
      'tenants',
      'roles',
      'profile',
    ])
    expect(ast.projections[2]?.expr.steps[0]).toEqual({
      kind: 'edge',
      dir: 'out',
      edge: 'member_of',
      target: 'tenant',
    })
    expect(ast.projections[2]?.children?.map((child) => child.name)).toEqual(['id', 'name'])
    expect(ast.projections[3]?.expr.steps[0]).toEqual({
      kind: 'edge',
      dir: 'in',
      edge: 'member_of',
    })
    expect(ast.projections[4]?.children?.[1]).toEqual({
      name: 'avatar',
      expr: { steps: [{ kind: 'field', name: 'avatar_url' }] },
    })
  })

  it('parses dotted field paths and a both-way edge', () => {
    const ast = parseShape(
      'SELECT address.city AS city, <->knows<->person AS friends FROM ONLY $id;',
    )

    expect(ast.projections[0]).toEqual({
      name: 'city',
      expr: {
        steps: [
          { kind: 'field', name: 'address' },
          { kind: 'field', name: 'city' },
        ],
      },
    })
    expect(ast.projections[1]?.expr.steps).toEqual([
      { kind: 'edge', dir: 'both', edge: 'knows', target: 'person' },
    ])
  })

  it('keeps an inner query on an edge and reads its target table', () => {
    const ast = parseShape(
      'SELECT ->member_of->(SELECT name FROM tenant WHERE active LIMIT 3) AS tenants FROM ONLY $id;',
    )

    expect(ast.projections[0]?.expr.steps[0]).toEqual({
      kind: 'edge',
      dir: 'out',
      edge: 'member_of',
      target: 'tenant',
      inner: 'SELECT name FROM tenant WHERE active LIMIT 3',
    })
  })

  it('parses FROM table with tail clauses', () => {
    const ast = parseShape('SELECT name FROM identity WHERE email = $email ORDER BY name LIMIT 10;')

    expect(ast.from).toEqual({ kind: 'table', table: 'identity', only: false })
    expect(ast.tail).toBe('WHERE email = $email ORDER BY name LIMIT 10')
  })

  it('accepts fields named like clause keywords', () => {
    const ast = parseShape('SELECT group, timeout FROM team WHERE active = true;')

    expect(ast.projections.map((projection) => projection.name)).toEqual(['group', 'timeout'])
  })

  it('rejects statements outside the dialect', () => {
    expect(() => parseShape('LET $x = 1;')).toThrow(/shape must be a SELECT/)
    expect(() => parseShape('SELECT count() FROM identity GROUP ALL;')).toThrow(
      /GROUP is not allowed in a shape/,
    )
    expect(() => parseShape('SELECT * FROM identity;')).toThrow(/list the fields/)
  })
})
