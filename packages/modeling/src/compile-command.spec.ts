import { describe, expect, it } from 'vitest'

import { compileCommand } from './compile-command'
import type { SchemaModel } from './schema-structure'

const schema: SchemaModel = {
  tables: {
    user: {
      replicate: 'none',
      idPrefix: 'usr',
      fields: { name: { kind: 'scalar', name: 'string' } },
    },
    profile: {
      region: 'private',
      idPrefix: 'prf',
      crdt: { bio: 'text', tags: 'list' },
      fields: {
        user: { kind: 'record', tables: ['user'] },
        name: { kind: 'scalar', name: 'string' },
        bio: { kind: 'option', inner: { kind: 'scalar', name: 'string' } },
        tags: { kind: 'array', inner: { kind: 'scalar', name: 'string' } },
        locale: { kind: 'option', inner: { kind: 'scalar', name: 'string' } },
        seen_at: { kind: 'option', inner: { kind: 'scalar', name: 'datetime' } },
      },
    },
  },
}

const id = { name: 'id', type: 'record<profile>' }

const compile = (body: string, params = [id, { name: 'name', type: 'string' }]) =>
  compileCommand({ name: 'cmd', params }, body, schema)

describe('compileCommand', () => {
  it('compiles an UPDATE SET into set operations', () => {
    expect(compile('UPDATE $id SET name = $name;')).toEqual({
      tables: ['profile'],
      region: 'private',
      ops: [{ op: 'set', record: 'id', field: 'name', value: { param: 'name' } }],
    })
  })

  it('uses text.update for a @crdt text field', () => {
    expect(
      compile('UPDATE $id SET bio = $bio;', [id, { name: 'bio', type: 'string' }]).ops,
    ).toEqual([{ op: 'text.update', record: 'id', field: 'bio', value: { param: 'bio' } }])
  })

  it('compiles list additions and removals on a @crdt list field', () => {
    expect(
      compile('UPDATE $id SET tags += $tag, tags -= "old";', [id, { name: 'tag', type: 'string' }])
        .ops,
    ).toEqual([
      { op: 'list.push', record: 'id', field: 'tags', value: { param: 'tag' } },
      { op: 'list.remove', record: 'id', field: 'tags', value: { literal: 'old' } },
    ])
  })

  it('compiles literals, NONE, the clock and UNSET', () => {
    expect(compile("UPDATE $id SET locale = 'en', bio = NONE, seen_at = time::now();").ops).toEqual(
      [
        { op: 'set', record: 'id', field: 'locale', value: { literal: 'en' } },
        { op: 'unset', record: 'id', field: 'bio' },
        { op: 'set', record: 'id', field: 'seen_at', value: { now: true } },
      ],
    )
    expect(compile('UPDATE $id UNSET locale, bio;').ops).toEqual([
      { op: 'unset', record: 'id', field: 'locale' },
      { op: 'unset', record: 'id', field: 'bio' },
    ])
  })

  it('compiles CREATE with a client id and DELETE', () => {
    const params = [id, { name: 'user', type: 'record<user>' }, { name: 'name', type: 'string' }]

    expect(compile('CREATE $id SET user = $user, name = $name;', params).ops).toEqual([
      { op: 'create', record: 'id', fields: { user: { param: 'user' }, name: { param: 'name' } } },
    ])
    expect(compile('DELETE $id;', [id]).ops).toEqual([{ op: 'delete', record: 'id' }])
  })

  it('refuses what cannot become replica operations', () => {
    expect(() => compile('UPDATE $id SET name = string::uppercase($name);')).toThrow(
      /not compilable to replica ops/,
    )
    expect(() => compile('UPDATE $id SET name = $name WHERE name = "a";')).toThrow(
      /not compilable to replica ops/,
    )
    expect(() => compile('UPSERT $id SET name = $name;')).toThrow(/not compilable to replica ops/)
    expect(() => compile('UPDATE $id SET nickname = $name;')).toThrow(
      /profile has no field nickname/,
    )
    expect(() => compile('UPDATE $id SET tags = $name;')).toThrow(/tags is a @crdt list/)
  })

  it('refuses a command on a server-only table', () => {
    expect(() =>
      compileCommand(
        {
          name: 'rename',
          params: [
            { name: 'id', type: 'record<user>' },
            { name: 'name', type: 'string' },
          ],
        },
        'UPDATE $id SET name = $name;',
        schema,
      ),
    ).toThrow(/user is server-only/)
  })

  it('refuses a record target that is not a record parameter', () => {
    expect(() => compile('UPDATE $name SET name = $name;')).toThrow(/declared as record<table>/)
  })
})
