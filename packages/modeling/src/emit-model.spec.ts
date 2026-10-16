import { describe, expect, it } from 'vitest'

import type { CommandFile, ShapeFile } from './collect'
import { emitModel, emitReplicaSchema } from './emit-model'
import type { SchemaModel } from './schema-structure'
import { parseShape } from './shape-dialect'

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
      crdt: { bio: 'text' },
      fields: {
        user: { kind: 'record', tables: ['user'] },
        name: { kind: 'scalar', name: 'string' },
        bio: { kind: 'option', inner: { kind: 'scalar', name: 'string' } },
        created_at: { kind: 'scalar', name: 'datetime' },
      },
    },
  },
}

const place = {
  name: 'profile',
  module: 'user',
  moduleDir: 'features/user',
  componentDir: 'features/user/presentation/pages/profile',
}

const body = 'SELECT id, name, bio FROM profile WHERE user = $user LIMIT 1;\n'

const shape: ShapeFile = {
  ...place,
  path: `${place.componentDir}/profile.shape.surql`,
  id: 'user.profile',
  header: { kind: 'shape', params: [{ name: 'user', type: 'record<user>' }], server: false },
  body,
  ast: parseShape(body),
  tables: ['profile'],
  region: 'private',
  resultType: 'Array<{ id: ProfileId; name: string; bio?: string | undefined }>',
}

const commands: CommandFile = {
  ...place,
  path: `${place.componentDir}/profile.commands.surql`,
  id: 'user.profile',
  commands: [
    {
      id: 'user.profile.updateBio',
      name: 'updateBio',
      header: {
        kind: 'command',
        name: 'updateBio',
        params: [
          { name: 'id', type: 'record<profile>' },
          { name: 'bio', type: 'option<string>' },
        ],
        allow: ['record'],
        deny: [],
      },
      body: 'UPDATE $id SET bio = $bio;\n',
      tables: ['profile'],
      region: 'private',
      ops: [{ op: 'text.update', record: 'id', field: 'bio', value: { param: 'bio' } }],
    },
  ],
}

describe('emitModel', () => {
  const files = emitModel({ shape, commands }, schema)

  it('writes one model module and a declaration per .surql file', () => {
    expect(files.map((file) => file.path)).toEqual([
      `${place.componentDir}/profile.model.gen.ts`,
      `${place.componentDir}/profile.shape.surql.d.ts`,
      `${place.componentDir}/profile.commands.surql.d.ts`,
    ])
  })

  it('generates typed shape and command objects with parameter schemas', () => {
    expect(files[0]?.text).toMatchSnapshot()
    expect(files[1]?.text).toMatchSnapshot()
    expect(files[2]?.text).toMatchSnapshot()
  })

  it('is byte-for-byte stable', () => {
    expect(emitModel({ shape, commands }, schema)).toEqual(files)
  })
})

describe('emitReplicaSchema', () => {
  it('lists the CRDT, reference and datetime fields of replicated tables', () => {
    expect(emitReplicaSchema(schema)).toMatchSnapshot()
  })
})
