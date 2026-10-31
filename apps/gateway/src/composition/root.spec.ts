import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ok } from 'neverthrow'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { applySchema } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema } from '@workspace/data/testing'
import { idSchemas } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { deviceHeaders } from '../auth/__fixtures__/auth-instance'
import { DIRECTORY, NAMESPACE } from '../config'

import { createGatewayRoot, type GatewayRoot } from './root'

/** The device Ann signs up on. */
const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

/** The auth secret of these tests. Test-only. */
const AUTH_SECRET = 'test-secret-0123456789-0123456789-0123456789'

/** The options every root of these tests opens with, but where its database lives. */
const rootOptions = {
  engines: nodeEngines(),
  authSecret: AUTH_SECRET,
  publicUrl: 'http://localhost',
} as const

/** Signs Ann up on her laptop through the root's Better Auth: her identity and raw token. */
async function signUpAnn(root: GatewayRoot) {
  const { token, user } = await root.auth.api.signUpEmail({
    body: { name: 'Ann', ...ann },
    headers: deviceHeaders(laptop.id, laptop.label),
  })

  return {
    identity: idSchemas.identity.schema.parse(user.id),
    token: token ?? expect.unreachable('the sign-up answered a session token'),
  }
}

describe('createGatewayRoot', () => {
  it('opens the directory database and serves sign-up and sessions over it', async () => {
    const root = (
      await createGatewayRoot({ ...rootOptions, url: 'mem://', clock: manualClock() })
    )._unsafeUnwrap()

    try {
      const { identity, token } = await signUpAnn(root)
      const read = await root.sessions.read(token)

      expect(root.local.db.namespace).toBe(NAMESPACE)
      expect(root.local.db.database).toBe(DIRECTORY)
      expect(identity).toMatch(/^idn_/)
      expect(read).toMatchObject({
        kind: 'session',
        caller: { identity, email: ann.email, device: laptop.id },
      })
      // The device it signed up on is recorded in the directory.
      expect(
        (await root.deviceSessions.list(identity))._unsafeUnwrap().map((row) => row.device),
      ).toEqual([laptop.id])
      expect(root.hub.loadedRegions()).toBe(0)
    } finally {
      await root.close()
    }
  })

  it("serves Better Auth's routes at the front's public path of the auth routes", async () => {
    const root = (
      await createGatewayRoot({ ...rootOptions, url: 'mem://', clock: manualClock() })
    )._unsafeUnwrap()

    try {
      const { token } = await signUpAnn(root)
      const read = (path: string) =>
        root.auth.handler(
          new Request(`http://localhost${path}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
        )

      expect((await read('/backend/auth/get-session')).status).toBe(200)
      expect((await read('/auth/get-session')).status).toBe(404)
    } finally {
      await root.close()
    }
  })

  it('builds the organisations over the directory and closes their databases with it', async () => {
    const root = (
      await createGatewayRoot({ ...rootOptions, url: 'mem://', clock: manualClock() })
    )._unsafeUnwrap()
    const { identity } = await signUpAnn(root)
    const acme = (
      await root.organisations.create({ identity, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()
    const handle = (await root.databases.acquire('acme'))._unsafeUnwrap()

    expect(await root.organisations.membershipsOf(identity)).toEqual(ok([acme]))
    expect(handle.local.db.namespace).toBe(NAMESPACE)
    expect(handle.local.db.database).toBe('t_acme')

    // The organisation's database is still held when the gateway closes.
    await expect(root.close()).resolves.toBeUndefined()
  })
})

describe('createGatewayRoot over a directory on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perch-gateway-root-'))
  const open: GatewayRoot[] = []
  /** Another secret than the one the directory was first opened with. Test-only. */
  const otherSecret = 'root-spec-other-auth-secret-'.padEnd(64, '1')

  async function openRoot(path: string, authSecret: string): Promise<GatewayRoot> {
    const root = (
      await createGatewayRoot({
        ...rootOptions,
        url: `surrealkv://${path}`,
        clock: manualClock(),
        authSecret,
      })
    )._unsafeUnwrap()

    open.push(root)

    return root
  }

  async function closeFirst(root: GatewayRoot): Promise<void> {
    open.splice(open.indexOf(root), 1)
    await root.close()
  }

  // A file database stays locked until it is closed, also when a test fails.
  afterEach(async () => {
    await Promise.all(open.splice(0).map((root) => root.close()))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps a session live when the directory schema is applied again', async () => {
    const root = await openRoot(mkdtempSync(join(dir, 'directory-')), AUTH_SECRET)
    const { identity, token } = await signUpAnn(root)

    ;(await applySchema(root.local, readSchema('directory')))._unsafeUnwrap()

    expect(await root.sessions.read(token)).toMatchObject({
      kind: 'session',
      caller: { identity, device: laptop.id },
    })
  })

  it('keeps a session live when the gateway opens the directory again with another auth secret', async () => {
    const path = mkdtempSync(join(dir, 'directory-'))
    const first = await openRoot(path, AUTH_SECRET)
    const { identity, token } = await signUpAnn(first)

    await closeFirst(first)

    const second = await openRoot(path, otherSecret)

    expect(await second.sessions.read(token)).toMatchObject({
      kind: 'session',
      caller: { identity, device: laptop.id },
    })
  })
})
