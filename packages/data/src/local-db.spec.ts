import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createAuth } from './auth'
import { onChange } from './changes'
import { runCommand } from './commands'
import { nodeEngines } from './engines/node'
import { openLocalDb } from './local-db'
import { ShapeRunner } from './shape-runner'
import { readSchema } from './testing'
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

describe('a device database that is closed and opened again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perch-local-db-'))
  const open: LocalDb[] = []
  const reopen = async (schemaText: string): Promise<LocalDb> => {
    const opened = await openLocalDb({
      engines: nodeEngines(),
      url: `surrealkv://${dir}`,
      namespace: 'app',
      database: 'app',
      schema: schemaText,
    })

    if (opened.isErr()) {
      throw opened.error.cause
    }

    open.push(opened.value)

    return opened.value
  }
  const auth = (db: LocalDb) =>
    createAuth(db, { access: 'user', namespace: 'app', database: 'app' })
  const full = readSchema()

  // A file database stays locked until it is closed, also when a test fails.
  afterEach(async () => {
    await Promise.all(open.splice(0).map((db) => db.close()))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps earlier sessions valid when its schema has not changed', async () => {
    const first = await reopen(full)
    const signedUp = auth(first)
    const user = (
      await signedUp.signUp({ email: 'd@example.test', password: 'secret-d', name: 'Dee' })
    )._unsafeUnwrap()
    const token = signedUp.token() ?? ''

    await first.close()
    open.splice(open.indexOf(first), 1)

    const second = await reopen(full)

    expect((await auth(second).resume(token))._unsafeUnwrap()).toEqual(user)
  })

  it('applies a schema that changed since the last opening', async () => {
    const changed = await reopen(`${full}\n${read('./__fixtures__/longer-user-names.surql')}`)
    const written = await runCommand(changed, createUser, { email: 'e@example.test', name: 'E' })

    expect(written._unsafeUnwrapErr().code).toBe('data:COMMAND_FAILED')
  })
})
