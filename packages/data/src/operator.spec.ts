import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { nodeEngines } from './engines/node'
import { remoteEngines } from './engines/remote'
import { openLocalDb } from './local-db'
import { runAsOperator } from './operator'
import { readSchema } from './testing'
import type { LocalDb } from './types'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

const gatewayUser = read('./__fixtures__/operator-gateway-user.surql')

describe('runAsOperator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perch-operator-'))
  const url = `surrealkv://${dir}`
  const open: LocalDb[] = []
  const signIn = (password: string) =>
    openLocalDb({
      engines: nodeEngines(),
      url,
      namespace: 'app',
      database: 'directory',
      schema: readSchema(),
      credentials: { username: 'gateway', password, namespace: 'app' },
    }).map((db) => {
      open.push(db)

      return db
    })

  // A file database stays locked until it is closed, also when a test fails.
  afterEach(async () => {
    await Promise.all(open.splice(0).map((db) => db.close()))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('defines a namespace user that can then sign in, and closes its connection', async () => {
    const ran = await runAsOperator({ engines: nodeEngines(), url }, gatewayUser)

    expect(ran.isOk()).toBe(true)

    // A refused sign-in first: an open connection would hold the file's lock.
    const wrong = (await signIn('not-the-password'))._unsafeUnwrapErr()

    expect(wrong.code).toBe('data:OPEN_FAILED')
    expect(String(wrong.cause)).toMatch(/authentication/)
    expect((await signIn('operator-test-password')).isOk()).toBe(true)
  })

  it('runs again on a stand that already holds what it defines', async () => {
    const ran = await runAsOperator({ engines: nodeEngines(), url }, gatewayUser)

    expect(ran.isOk()).toBe(true)
    expect((await signIn('operator-test-password')).isOk()).toBe(true)
  })

  it('reports a statement the database refuses', async () => {
    const ran = await runAsOperator({ engines: nodeEngines(), url: 'mem://' }, ')) unbalanced')

    expect(ran._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
  })

  it('reports a server it cannot reach instead of retrying', async () => {
    const ran = await runAsOperator(
      {
        engines: remoteEngines(),
        url: 'ws://127.0.0.1:1/rpc',
        credentials: { username: 'root', password: 'root' },
      },
      gatewayUser,
    )

    expect(ran._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
  })
})
