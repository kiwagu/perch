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
  tables: ['user'],
  region: 'server',
  ops: [],
}

const userByEmail: Shape<{ email: string }, Array<{ name: string }>> = {
  id: 'fixture.user-by-email',
  kind: 'shape',
  text: read('./__fixtures__/user-by-email.surql'),
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

  it('fails to open when the schema does not parse', async () => {
    const opened = await openLocalDb({
      engines: nodeEngines(),
      url: 'mem://',
      namespace: 'app',
      database: 'app',
      schema: 'DEFINE TABLE ;',
    })

    expect(opened._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
  })
})
