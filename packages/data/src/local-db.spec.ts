import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ok } from 'neverthrow'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { onChange } from './changes'
import { runCommand } from './commands'
import { nodeEngines } from './engines/node'
import { applySchema, deleteLocalDb, openLocalDb } from './local-db'
import { ShapeRunner } from './shape-runner'
import { readSchema } from './testing'
import type { Command, LocalDb, Shape } from './types'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

const schema = read('../../../database/schema/directory/identity.surql')

const createIdentity: Command<{ email: string }> = {
  id: 'fixture.create-identity',
  kind: 'command',
  text: read('./__fixtures__/create-identity.surql'),
  params: [{ name: 'email', type: 'string' }],
  tables: ['identity'],
  region: 'server',
  ops: [],
}

const identityByEmail: Shape<{ email: string }, Array<{ email: string }>> = {
  id: 'fixture.identity-by-email',
  kind: 'shape',
  text: read('./__fixtures__/identity-by-email.surql'),
  params: [{ name: 'email', type: 'string' }],
  tables: ['identity'],
}

const createIdentityWithId: Command<{ id: string; email: string }> = {
  id: 'fixture.create-identity-with-id',
  kind: 'command',
  text: read('./__fixtures__/create-identity-with-id.surql'),
  params: [
    { name: 'id', type: 'record<identity>' },
    { name: 'email', type: 'string' },
  ],
  tables: ['identity'],
  region: 'server',
  ops: [],
}

const identityById: Shape<{ id: string }, { id: string; email: string; created_at: Date }> = {
  id: 'fixture.identity-by-id',
  kind: 'shape',
  text: read('./__fixtures__/identity-by-id.surql'),
  params: [{ name: 'id', type: 'record<identity>' }],
  tables: ['identity'],
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
    const written = await runCommand(local, createIdentity, { email: 'a@example.test' })
    const tree = await new ShapeRunner(local).read(identityByEmail, { email: 'a@example.test' })

    expect(written.isOk()).toBe(true)
    expect(tree._unsafeUnwrap()).toEqual([{ email: 'a@example.test' }])
  })

  it('publishes a table change after a command', async () => {
    const seen: string[][] = []
    const stop = onChange(local, (change) => seen.push([...change.tables]))
    const written = await runCommand(local, createIdentity, { email: 'b@example.test' })

    stop()

    expect(written.isOk()).toBe(true)
    expect(seen).toEqual([['identity']])
  })

  it('reports a command the schema rejects', async () => {
    const written = await runCommand(local, createIdentity, { email: 'not-an-email' })

    expect(written._unsafeUnwrapErr().code).toBe('data:COMMAND_FAILED')
  })

  it('takes entity ids for record parameters and returns plain keys and dates', async () => {
    const id = 'idn_0000000000000000.01m52pexcp'
    const written = await runCommand(local, createIdentityWithId, { id, email: 'c@example.test' })
    const tree = (await new ShapeRunner(local).read(identityById, { id }))._unsafeUnwrap()

    expect(written.isOk()).toBe(true)
    expect(tree.created_at).toBeInstanceOf(Date)
    expect(tree).toEqual({ id, email: 'c@example.test', created_at: tree.created_at })
  })

  it('applies a schema to a database that is open', async () => {
    const memory = (
      await openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: 'app',
        database: 'app',
        schema,
      })
    )._unsafeUnwrap()

    try {
      const longer = `${schema}\n${read('./__fixtures__/longer-identity-emails.surql')}`

      expect(await applySchema(memory, longer)).toEqual(ok(undefined))
      expect(
        (await runCommand(memory, createIdentity, { email: 'l@example.test' }))._unsafeUnwrapErr()
          .code,
      ).toBe('data:COMMAND_FAILED')
    } finally {
      await memory.close()
    }
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

describe('destroying a database', () => {
  const openMemory = async (): Promise<LocalDb> =>
    (
      await openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: 'app',
        database: 'app',
        schema,
      })
    )._unsafeUnwrap()

  it('closes an in-memory database, which leaves nothing behind', async () => {
    const memory = await openMemory()

    expect((await runCommand(memory, createIdentity, { email: 'g@example.test' })).isOk()).toBe(
      true,
    )

    await memory.destroy()

    expect(
      (await new ShapeRunner(memory).read(identityByEmail, { email: 'g@example.test' })).isErr(),
    ).toBe(true)
  })

  it('may follow a close, and closing twice is harmless', async () => {
    const memory = await openMemory()

    await memory.close()
    await memory.close()
    await expect(memory.destroy()).resolves.toBeUndefined()
  })

  it('deletes the IndexedDB database of an address that is not open, by its name', async () => {
    const deleted: string[] = []

    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => {
        const request = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: null,
        }

        deleted.push(name)
        queueMicrotask(() => request.onsuccess?.())

        return request
      },
    })

    try {
      expect(await deleteLocalDb('indxdb://app-identity-idn_x-t_acme')).toEqual(ok(undefined))
      expect(deleted).toEqual(['app-identity-idn_x-t_acme'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('deletes nothing for an in-memory address, and refuses an address it cannot delete', async () => {
    expect(await deleteLocalDb('mem://')).toEqual(ok(undefined))
    expect((await deleteLocalDb('surrealkv:///tmp/x'))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_FAILED',
    )
    // Without IndexedDB there is nothing to delete an `indxdb://` address with.
    expect((await deleteLocalDb('indxdb://app-identity-idn_x'))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_FAILED',
    )
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
  const full = readSchema('directory')
  const closeFirst = async (db: LocalDb): Promise<void> => {
    await db.close()
    open.splice(open.indexOf(db), 1)
  }

  // A file database stays locked until it is closed, also when a test fails.
  afterEach(async () => {
    await Promise.all(open.splice(0).map((db) => db.close()))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('leaves a schema it already applied alone', async () => {
    const first = await reopen(full)

    // A change behind the schema's back, which applying the schema again would undo.
    await first.db.query(read('./__fixtures__/longer-identity-emails.surql'))
    await closeFirst(first)

    const second = await reopen(full)
    const written = await runCommand(second, createIdentity, { email: 'k@example.test' })

    expect(written._unsafeUnwrapErr().code).toBe('data:COMMAND_FAILED')
  })

  it('connects as a namespace user when the credentials name the namespace', async () => {
    const first = await reopen(full)

    await first.db.query(read('./__fixtures__/namespace-user.surql'))
    await closeFirst(first)

    const asUser = (credentials: { username: string; password: string; namespace?: string }) =>
      openLocalDb({
        engines: nodeEngines(),
        url: `surrealkv://${dir}`,
        namespace: 'app',
        database: 'app',
        schema: full,
        credentials,
      }).map((db) => {
        open.push(db)

        return db
      })
    const user = { username: 'gateway', password: 'gateway-pass' }
    // Without the namespace the user is looked up among the root users, where it is not.
    const asRoot = (await asUser(user))._unsafeUnwrapErr()

    expect(asRoot.code).toBe('data:OPEN_FAILED')
    expect(String(asRoot.cause)).toMatch(/authentication/)
    expect((await asUser({ ...user, namespace: 'app' })).isOk()).toBe(true)
  })

  it('applies a schema that changed since the last opening', async () => {
    const changed = await reopen(`${full}\n${read('./__fixtures__/longer-identity-emails.surql')}`)
    const written = await runCommand(changed, createIdentity, { email: 'e@example.test' })

    expect(written._unsafeUnwrapErr().code).toBe('data:COMMAND_FAILED')
  })
})
