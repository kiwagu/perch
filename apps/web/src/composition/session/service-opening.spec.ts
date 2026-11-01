import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { createProfile, profileById } from '../__fixtures__/profile'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { type MemoryStorage, memoryStorage, saveDevice } from '../storage'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

/** A promise and the function that resolves it. */
function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })

  return { promise, resolve }
}

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/** A browser that keeps Ann signed in from an earlier sign-in. */
function annSaved(): MemoryStorage {
  const storage = memoryStorage()

  saveDevice(storage, ann)

  return storage
}

/** A tab of a browser that keeps Ann, offline, whose database opens once the test lets it. */
async function annOpeningHeld() {
  const held = deferred()
  const shared = browserDatabases()
  const storage = annSaved()
  const tab = await world({
    storage,
    online: false,
    databases: {
      open: (identity) =>
        ResultAsync.fromSafePromise(held.promise).andThen(() => shared.open(identity)),
    },
  })

  return { ...tab, storage, open: held.resolve }
}

describe("the start's open of the saved identity's space", () => {
  it('names the saved identity while the space opens, and reads and writes wait for it', async () => {
    const held = deferred()
    const shared = browserDatabases()
    const { session } = await world({
      storage: annSaved(),
      online: false,
      // The identity's database opens only once the test lets it.
      databases: {
        open: (identity) =>
          ResultAsync.fromSafePromise(held.promise).andThen(() => shared.open(identity)),
      },
    })
    const restoring = session.restore()
    const id = profileIdFactory.create()
    const errors: DataError[] = []
    const watched: unknown[] = []

    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.space()).toBeUndefined()

    const written = session.writePath.run(createProfile, {
      id,
      identity: ann.identity.id,
      name: 'Ann',
      email: ann.identity.email,
    })
    const read = session.runner.read(profileById, { id })
    const stop = session.runner.watch(profileById, { id }, (tree) => watched.push(tree), {
      onError: (error) => errors.push(error),
    })

    held.resolve()

    expect((await restoring).isOk()).toBe(true)
    expect((await written).isOk()).toBe(true)
    expect((await read).isOk()).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)
    await vi.waitFor(() => expect(watched.at(-1)).toMatchObject({ name: 'Ann' }))
    expect(errors).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)
    stop()
  })

  it('leaves nobody current when the space does not open, and what waited for it refuses', async () => {
    const { session } = await world({
      storage: annSaved(),
      online: false,
      refusedIdentities: [ann.identity.id],
    })
    const restoring = session.restore()

    expect(session.current()?.id).toBe(ann.identity.id)

    const read = session.runner.read(profileById, { id: profileIdFactory.create() })

    expect((await restoring)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect((await read)._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect(session.current()).toBeUndefined()
  })

  it('adopts an organisation created while the space opens, once it is open', async () => {
    const { session, open } = await annOpeningHeld()
    const restoring = session.restore()
    const adopted = session.adoptMembership(acme)

    open()

    expect((await restoring).isOk()).toBe(true)
    await adopted
    expect(session.memberships().map(({ tenant }) => tenant.key)).toEqual(['acme'])
  })

  it('signs this device out everywhere when asked while the space opens, once it is open, with no channel', async () => {
    const { session, storage, open } = await annOpeningHeld()
    const restoring = session.restore()
    const signOutHere = session.signingOutEverywhere()

    open()

    expect((await restoring).isOk()).toBe(true)
    expect((await signOutHere()).isOk()).toBe(true)
    expect(session.current()).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(session.notice()).toBe('signed-out-elsewhere')
  })

  it('names nobody while it opens when nobody is saved', async () => {
    const { session } = await world({ online: false })
    const restoring = session.restore()

    expect(session.current()).toBeUndefined()
    expect((await restoring).isOk()).toBe(true)
    expect(
      (await session.runner.read(profileById, { id: profileIdFactory.create() }))._unsafeUnwrapErr()
        .code,
    ).toBe('data:QUERY_FAILED')
  })
})
