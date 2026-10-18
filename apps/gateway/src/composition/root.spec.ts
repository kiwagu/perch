import { ok } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { nodeEngines } from '@workspace/data/engines/node'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { createGatewayRoot } from './root'

/** The device Ann signs up on. */
const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

describe('createGatewayRoot', () => {
  it('opens the directory database and serves sign-in over it', async () => {
    const root = (
      await createGatewayRoot({
        engines: nodeEngines(),
        url: 'mem://',
        clock: manualClock(),
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
