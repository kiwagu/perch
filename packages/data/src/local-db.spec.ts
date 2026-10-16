import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { onChange } from './changes'
import { runCommand } from './commands'
import { nodeEngines } from './engines/node'
import { openLocalDb } from './local-db'
import { ShapeRunner } from './shape-runner'
import type { Command, LocalDb, Shape } from './types'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

const schema = read('../../../database/schema/user.surql')

const createUser: Command<{ email: string; name: string }> = {
  id: 'fixture.create-user',
  kind: 'command',
  text: read('./__fixtures__/create-user.surql'),
  params: [
    { name: 'email', type: 'string' },
    { name: 'name', type: 'string' },
  ],
  tables: ['user'],
  region: 'server',
  ops: [],
}

const userByEmail: Shape<{ email: string }, Array<{ name: string }>> = {
  id: 'fixture.user-by-email',
  kind: 'shape',
  text: read('./__fixtures__/user-by-email.surql'),
  params: [{ name: 'email', type: 'string' }],
  tables: ['user'],
}

const createUserWithId: Command<{ id: string; email: string; name: string }> = {
  id: 'fixture.create-user-with-id',
  kind: 'command',
  text: read('./__fixtures__/create-user-with-id.surql'),
  params: [
    { name: 'id', type: 'record<user>' },
    { name: 'email', type: 'string' },
    { name: 'name', type: 'string' },
  ],
  tables: ['user'],
  region: 'server',
  ops: [],
}

const userById: Shape<{ id: string }, { id: string; name: string; created_at: Date }> = {
  id: 'fixture.user-by-id',
  kind: 'shape',
  text: read('./__fixtures__/user-by-id.surql'),
  params: [{ name: 'id', type: 'record<user>' }],
  tables: ['user'],
}

let local: LocalDb

beforeAll(async () => {
  const opened = await openLocalDb({
    engines: nodeEngines(),
    url: 'mem://',
    namespace: 'app',
    database: 'app',
    schema,
  })

  local = opened._unsafeUnwrap()
})

afterAll(async () => {
  await local.close()
})

describe('local db, shape runner and commands', () => {
  it('applies the schema, writes through a command and reads through a shape', async () => {
    const written = await runCommand(local, createUser, { email: 'a@example.test', name: 'A' })
    const tree = await new ShapeRunner(local).read(userByEmail, { email: 'a@example.test' })

    expect(written.isOk()).toBe(true)
    expect(tree._unsafeUnwrap()).toEqual([{ name: 'A' }])
  })

  it('publishes a table change after a command', async () => {
    const seen: string[][] = []
    const stop = onChange(local, (change) => seen.push([...change.tables]))
    const written = await runCommand(local, createUser, { email: 'b@example.test', name: 'B' })

    stop()

    expect(written.isOk()).toBe(true)
    expect(seen).toEqual([['user']])
  })

  it('reports a command the schema rejects', async () => {
    const written = await runCommand(local, createUser, { email: 'not-an-email', name: 'C' })

    expect(written._unsafeUnwrapErr().code).toBe('data:COMMAND_FAILED')
  })

  it('takes entity ids for record parameters and returns plain keys and dates', async () => {
    const id = 'usr_0000000000000000.01m52pexcp'
    const written = await runCommand(local, createUserWithId, {
      id,
      email: 'c@example.test',
      name: 'C',
    })
    const tree = (await new ShapeRunner(local).read(userById, { id }))._unsafeUnwrap()

    expect(written.isOk()).toBe(true)
    expect(tree).toEqual({ id, name: 'C', created_at: expect.any(Date) })
  })

  it('fails to open when the schema does not parse', async () => {
    const opened = await openLocalDb({
      engines: nodeEngines(),
      url: 'mem://',
      namespace: 'app',
      database: 'app',
      schema: ')) unbalanced',
    })

    expect(opened._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
  })
})
