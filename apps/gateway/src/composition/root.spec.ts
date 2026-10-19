import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ok } from 'neverthrow'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { applySchema } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema, TEST_SIGNING_KEY } from '@workspace/data/testing'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { createGatewayRoot, type GatewayRoot } from './root'

/** The device Ann signs up on. */
const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

describe('createGatewayRoot', () => {
  it('opens the directory database and serves sign-in over it', async () => {
    const root = (
      await createGatewayRoot({
        engines: nodeEngines(),
        url: 'mem://',
        clock: manualClock(),
        signingKey: TEST_SIGNING_KEY,
      })
    )._unsafeUnwrap()

    try {
      const up = await root.sessions.signUp(
        { email: 'ann@example.test', password: 'pass-word-1' },
        laptop,
      )
      const { identity } = up._unsafeUnwrap()

      expect(root.local.db.namespace).toBe(NAMESPACE)
      expect(root.local.db.database).toBe(DIRECTORY)
      expect(identity.id).toMatch(/^idn_/)
      // The device it signed up on is recorded in the directory.
      expect(
        (await root.deviceSessions.list(identity.id))._unsafeUnwrap().map((row) => row.device),
      ).toEqual([laptop.id])
      expect(root.hub.loadedRegions()).toBe(0)
    } finally {
      await root.close()
    }
  })

  it('builds the organisations over the directory and closes their databases with it', async () => {
    const root = (
      await createGatewayRoot({
        engines: nodeEngines(),
        url: 'mem://',
        clock: manualClock(),
        signingKey: TEST_SIGNING_KEY,
      })
    )._unsafeUnwrap()
    const { identity } = (
      await root.sessions.signUp({ email: 'ann@example.test', password: 'pass-word-1' }, laptop)
    )._unsafeUnwrap()
    const acme = (
      await root.organisations.create({ identity: identity.id, key: 'acme', name: 'Acme' })
    )._unsafeUnwrap()
    const handle = (await root.databases.acquire('acme'))._unsafeUnwrap()

    expect(await root.organisations.membershipsOf(identity.id)).toEqual(ok([acme]))
    expect(handle.local.db.namespace).toBe(NAMESPACE)
    expect(handle.local.db.database).toBe('t_acme')

    // The organisation's database is still held when the gateway closes.
    await expect(root.close()).resolves.toBeUndefined()
  })
})

describe('createGatewayRoot over a directory on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perch-gateway-root-'))
  const open: GatewayRoot[] = []
  /** Another key than the one the directory was first opened with. Test-only. */
  const otherKey = 'root-spec-other-signing-key-'.padEnd(64, '1')

  async function openRoot(path: string, signingKey: string): Promise<GatewayRoot> {
    const root = (
      await createGatewayRoot({
        engines: nodeEngines(),
        url: `surrealkv://${path}`,
        clock: manualClock(),
        signingKey,
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

  it('keeps an issued token valid when the directory schema is applied again with its key', async () => {
    const root = await openRoot(mkdtempSync(join(dir, 'directory-')), TEST_SIGNING_KEY)
    const { identity, tokens } = (await root.sessions.signUp(ann, laptop))._unsafeUnwrap()

    ;(await applySchema(root.local, readSchema('directory'), TEST_SIGNING_KEY))._unsafeUnwrap()

    const accepted = (await root.sessions.authenticate({ access: tokens.access }))._unsafeUnwrap()

    expect(accepted.renewed).toBe(false)
    expect(accepted.identity).toEqual(identity)
  })

  it('refuses earlier access tokens once opened with another key, and renews them with the refresh key', async () => {
    const path = mkdtempSync(join(dir, 'directory-'))
    const first = await openRoot(path, TEST_SIGNING_KEY)
    const { identity, tokens } = (await first.sessions.signUp(ann, laptop))._unsafeUnwrap()

    await closeFirst(first)

    const second = await openRoot(path, otherKey)
    const refused = await second.sessions.authenticate({ access: tokens.access })

    expect(refused._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')

    const renewed = (await second.sessions.authenticate(tokens))._unsafeUnwrap()

    expect(renewed.renewed).toBe(true)
    expect(renewed.identity).toEqual(identity)
  })
})
