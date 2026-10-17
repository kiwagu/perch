import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { collect } from './collect'
import type { SchemaModel } from './schema-structure'

const schema: SchemaModel = {
  tables: {
    identity: {
      replicate: 'none',
      idPrefix: 'idn',
      fields: { name: { kind: 'scalar', name: 'string' } },
    },
    profile: {
      region: 'private',
      idPrefix: 'prf',
      fields: {
        identity: { kind: 'record', tables: ['identity'] },
        name: { kind: 'scalar', name: 'string' },
      },
    },
    follows: {
      region: 'private',
      idPrefix: 'flw',
      relation: { in: ['identity'], out: ['profile'] },
      fields: {},
    },
    note: {
      region: 'tenant',
      idPrefix: 'nte',
      fields: { text: { kind: 'scalar', name: 'string' } },
    },
  },
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'collect-'))

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  return root
}

const page = 'features/user/presentation/pages/profile'

describe('collect', () => {
  it('finds shapes and commands and places them in their module', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]:
        '-- @params $identity: record<identity>\nSELECT id, name FROM profile WHERE identity = $identity;\n',
      [`${page}/profile.commands.surql`]:
        '-- @command updateName($id: record<profile>, $name: string)\n-- @allow record\nUPDATE $id SET name = $name;\n',
    })
    const { shapes, commands, problems } = await collect(root, schema)

    expect(problems).toEqual([])
    expect(shapes).toMatchObject([
      {
        id: 'user.profile',
        name: 'profile',
        module: 'user',
        moduleDir: 'features/user',
        componentDir: page,
        tables: ['profile'],
        region: 'private',
        resultType: 'Array<{ id: ProfileId; name: string }>',
      },
    ])
    expect(commands).toMatchObject([
      {
        id: 'user.profile',
        commands: [
          {
            id: 'user.profile.updateName',
            region: 'private',
            tables: ['profile'],
            ops: [{ op: 'set', record: 'id', field: 'name', value: { param: 'name' } }],
          },
        ],
      },
    ])
  })

  it('reports a component without a module, outside a component folder, or invalid', async () => {
    const root = project({
      'loose/loose.container.tsx': '',
      'loose/loose.shape.surql': 'SELECT name FROM profile;\n',
      'features/user/user.module.ts': '',
      'features/user/stray/other.shape.surql': 'SELECT name FROM profile;\n',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]: 'SELECT * FROM profile;\n',
    })
    const { shapes, problems } = await collect(root, schema)

    expect(shapes).toEqual([])
    expect(problems).toEqual([
      `${page}/profile.shape.surql: list the fields a shape needs instead of *`,
      'features/user/stray/other.shape.surql: a shape lives in its component folder: expected stray/stray.container.tsx or stray/stray.service.ts beside a file named stray.shape.surql',
      'loose/loose.shape.surql: no *.module.ts in this folder or above it',
    ])
  })

  it('requires @server when only the predicate reads a server-only table', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]:
        '-- @params $name: string\nSELECT name FROM profile WHERE identity.name = $name;\n',
    })

    expect((await collect(root, schema)).problems).toEqual([
      `${page}/profile.shape.surql: reads the server-only table identity; mark the shape -- @server or read a replicated table`,
    ])
  })

  it('requires @server when only a FETCH reads a server-only table', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]: 'SELECT name, identity FROM profile FETCH identity;\n',
    })

    expect((await collect(root, schema)).problems).toEqual([
      `${page}/profile.shape.surql: reads the server-only table identity; mark the shape -- @server or read a replicated table`,
    ])
  })

  it('requires @server when FETCH follows the incoming endpoint of a relation to a server-only table', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]: 'SELECT in, out FROM follows FETCH in;\n',
    })

    expect((await collect(root, schema)).problems).toEqual([
      `${page}/profile.shape.surql: reads the server-only table identity; mark the shape -- @server or read a replicated table`,
    ])
  })

  it('refuses a shape that reads tables of two databases', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]:
        '-- @params $note: record<note>\nSELECT name FROM profile WHERE name = $note.text;\n',
    })

    expect((await collect(root, schema)).problems).toEqual([
      `${page}/profile.shape.surql: reads tables of two databases: profile (private), note (tenant)`,
    ])
  })

  it('requires @server on a shape that reads a server-only table', async () => {
    const root = project({
      'features/user/user.module.ts': '',
      [`${page}/profile.container.tsx`]: '',
      [`${page}/profile.shape.surql`]:
        '-- @params $id: record<identity>\nSELECT name FROM ONLY $id;\n',
    })

    expect((await collect(root, schema)).problems).toEqual([
      `${page}/profile.shape.surql: reads the server-only table identity; mark the shape -- @server or read a replicated table`,
    ])
  })
})
