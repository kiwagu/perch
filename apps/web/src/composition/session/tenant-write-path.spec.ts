import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory, noteIdFactory, tenantIdFactory } from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import { createNote, type NoteRow, organisationShape } from '../__fixtures__/note'
import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { signedIn } from '../__fixtures__/signed-in'
import { type KeptDevice, memoryStorage } from '../storage'

/**
 * Writes into one organisation's tenant region, named by its key: whichever organisation is
 * current, under the identity's write lock as every write, and refused once that organisation's
 * database is not open or the caller's own condition no longer holds when the write is admitted.
 */

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: CONTRACT_ROLES.admin,
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: CONTRACT_ROLES.admin,
}

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [acme, globex],
}

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

/** Ann's session on a page load, offline, once its tab leads; `acme` is current, the first by key. */
async function annsSession() {
  const storage = memoryStorage()

  signedIn(storage, ann)

  const world = await openTestWorld({ storage, online: false })

  worlds.push(world)
  expect((await world.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(world.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

  return world
}

const aNote = (text: string) => ({ id: noteIdFactory.create(), author: ann.identity.id, text })

/** The texts of the notes the organisation `key`'s database holds on this device. */
async function notesOf(world: TestWorld, key: string): Promise<readonly string[]> {
  const view = world.session.space()?.tenant(key) ?? expect.unreachable(`${key} open`)
  const rows = (await view.runner.read(organisationShape, {}))._unsafeUnwrap() as NoteRow[]

  return rows.map((row) => row.text)
}

describe('tenantWritePath', () => {
  it('writes into the organisation it names while another is current', async () => {
    const world = await annsSession()

    expect(world.session.currentTenant()?.tenant.key).toBe('acme')
    expect(
      (await world.session.tenantWritePath('globex').run(createNote, aNote('to globex'))).isOk(),
    ).toBe(true)
    expect(await world.session.space()?.flush()).toBeDefined()

    expect(await notesOf(world, 'globex')).toEqual(['to globex'])
    expect(await notesOf(world, 'acme')).toEqual([])
  })

  it('refuses an organisation whose database is not open, writing nothing', async () => {
    const world = await annsSession()

    const written = await world.session.tenantWritePath('initech').run(createNote, aNote('lost'))

    expect(written._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(await notesOf(world, 'acme')).toEqual([])
  })

  it("refuses when the caller's condition no longer holds once the write is admitted", async () => {
    const world = await annsSession()

    const written = await world.session
      .tenantWritePath('globex', () => false)
      .run(createNote, aNote('not admitted'))

    expect(written._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(await notesOf(world, 'globex')).toEqual([])
  })
})
