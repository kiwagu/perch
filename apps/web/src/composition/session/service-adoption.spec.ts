import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import type { IdentitySpace } from '../identity-space'
import {
  IDENTITY_KEY,
  type KeptDevice,
  MEMBERSHIPS_KEY,
  type MemoryStorage,
  memoryStorage,
  saveDevice,
  savedMemberships,
  saveMemberships,
  saveSigningOut,
  TOKEN_KEY,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const bob: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Whether `promise` settles within two seconds of real time, for a step that must never hang. */
function settledWithin(promise: Promise<unknown>): Promise<'settled' | 'hung'> {
  return Promise.race([
    promise.then((): 'settled' => 'settled'),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2_000)),
  ])
}

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

/** A browser that keeps `device` signed in from an earlier sign-in. */
function kept(device: KeptDevice): MemoryStorage {
  const storage = memoryStorage()

  saveDevice(storage, device)

  return storage
}

/** A tab of a browser that keeps `device`, offline, its space open and leading. */
async function signedIn(device: KeptDevice = ann, options: TestWorldOptions = {}) {
  const storage = kept(device)
  const tab = await world({ storage, online: false, ...options })

  expect((await tab.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(tab.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

  const space = tab.session.space() ?? expect.unreachable('the space is open')

  return { ...tab, storage, space }
}

/** A tab of a browser that keeps Ann, offline, whose database opens once the test lets it. */
async function annOpeningHeld() {
  const held = deferred()
  const shared = browserDatabases()
  const storage = kept(ann)
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

/** Another tab of the browser signs the account out: the token goes, then the identity. */
function signedOutElsewhere(storage: MemoryStorage): void {
  storage.changeElsewhere(TOKEN_KEY, undefined)
  storage.changeElsewhere(IDENTITY_KEY, undefined)
}

/** Another tab of the browser signs `device` in: this tab hears each key it writes, in order. */
function signedInElsewhere(storage: MemoryStorage, device: KeptDevice): void {
  const other = memoryStorage()

  saveDevice(other, device)

  for (const key of [TOKEN_KEY, IDENTITY_KEY, MEMBERSHIPS_KEY]) {
    storage.changeElsewhere(key, other.get(key))
  }
}

/** Counts the writes of the saved memberships this tab makes from now on. */
function membershipWrites(storage: MemoryStorage): () => number {
  const set = vi.spyOn(storage, 'set')

  return () => set.mock.calls.filter(([key]) => key === MEMBERSHIPS_KEY).length
}

/** The lists `space` is told to follow from now on. */
function followed(space: IdentitySpace): () => ReadonlyArray<readonly Membership[]> {
  const set = vi.spyOn(space, 'setMemberships')

  return () => set.mock.calls.map(([next]) => next)
}

describe('the adopter of a membership the gateway answers', () => {
  it('adopts nothing into a space another account replaced', async () => {
    const { session, storage, tenantsOpened } = await signedIn()
    const adopt = session.membershipAdopter()

    signedInElsewhere(storage, bob)
    await vi.waitFor(() => expect(session.space()?.identity.id).toBe(bob.identity.id))

    const replacement = session.space() ?? expect.unreachable("Bob's space is open")
    const lists = followed(replacement)
    const writes = membershipWrites(storage)

    await adopt(acme)

    expect(writes()).toBe(0)
    expect(lists()).toEqual([])
    expect(savedMemberships(storage, bob.identity.id)).toEqual([])
    expect(session.memberships()).toEqual([])
    expect(tenantsOpened()).toEqual([])
  })

  it('the same account signed in again on another tab keeps this space, and adoption goes on', async () => {
    const { session, storage, space } = await signedIn()
    const adopt = session.membershipAdopter()

    signedInElsewhere(storage, { ...ann, token: 'token-ann-again' })
    await settle()
    expect(session.space()).toBe(space)

    await adopt(acme)

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
    expect(session.space()).toBe(space)
    expect(session.memberships()).toEqual([acme])
  })

  it('an adopter taken while the space opens adopts into the space that opening produced, not a later one of the same account', async () => {
    const { session, storage, open } = await annOpeningHeld()
    const restoring = session.restore()
    const adopt = session.membershipAdopter()

    open()
    expect((await restoring).isOk()).toBe(true)

    const produced = session.space() ?? expect.unreachable("Ann's space is open")

    // Another tab signed Ann out and in again before the answer: her space here is a new one.
    signedOutElsewhere(storage)
    await vi.waitFor(() => expect(session.space()).toBeUndefined())
    signedInElsewhere(storage, ann)
    await vi.waitFor(() => expect(session.space()?.identity.id).toBe(ann.identity.id))

    const later = session.space() ?? expect.unreachable("Ann's new space is open")

    expect(later).not.toBe(produced)

    const lists = followed(later)
    const writes = membershipWrites(storage)

    await adopt(acme)

    expect(writes()).toBe(0)
    expect(lists()).toEqual([])
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    expect(session.memberships()).toEqual([])
  })

  it("an opening queued behind an earlier transition binds to its own restore's space", async () => {
    const storage = kept(ann)
    const { session, opened } = await world({ storage, online: false })

    // Another tab's sign-in reached this tab first: its follow opens Ann's space before the restore does.
    storage.changeElsewhere(IDENTITY_KEY, storage.get(IDENTITY_KEY))

    const restoring = session.restore()
    const adopt = session.membershipAdopter()

    expect(session.current()?.id).toBe(ann.identity.id)
    expect((await restoring).isOk()).toBe(true)
    // The follow opened a space, and the restore closed it and opened its own.
    expect(opened()).toEqual([ann.identity.id, ann.identity.id])

    await adopt(acme)

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
    expect(session.memberships()).toEqual([acme])
  })

  it('an opening whose space did not open adopts nothing and resolves', async () => {
    const storage = kept(ann)
    const { session } = await world({
      storage,
      online: false,
      refusedIdentities: [ann.identity.id],
    })
    const restoring = session.restore()
    const adopt = session.membershipAdopter()

    expect((await restoring)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(await settledWithin(adopt(acme))).toBe('settled')
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    expect(session.space()).toBeUndefined()
  })

  it('adopts nothing while this browser signs out, its space still open', async () => {
    // The gateway is out of reach on a network: the sign-out waits for the channel, its barrier up.
    const { session, storage, space, driveClock } = await signedIn(ann, { network: true })
    const adopt = session.membershipAdopter()
    const signingOut = session.signOut()

    await vi.waitFor(() => expect(storage.get('perch.session.signing-out')).toBeDefined())
    expect(session.space()).toBe(space)

    const lists = followed(space)
    const writes = membershipWrites(storage)

    await adopt(acme)

    expect(writes()).toBe(0)
    expect(lists()).toEqual([])
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])

    expect((await driveClock(signingOut)).isOk()).toBe(true)
  })

  it('adopts nothing while another tab signs out, its space still open', async () => {
    const { session, storage, space, clock } = await signedIn()
    const adopt = session.membershipAdopter()

    // Another tab began a sign-out; this tab's space stays open until that sign-out ends it.
    saveSigningOut(storage, clock.now())

    const lists = followed(space)
    const writes = membershipWrites(storage)

    await adopt(acme)

    expect(writes()).toBe(0)
    expect(lists()).toEqual([])
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    expect(session.space()).toBe(space)
  })

  it('adopts nothing after the session closed', async () => {
    const { session, storage } = await signedIn()
    const adopt = session.membershipAdopter()
    const writes = membershipWrites(storage)

    await session.close()
    await adopt(acme)

    expect(writes()).toBe(0)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
  })

  it('writes nothing when the saved list names the organisation, also with another role saved by another tab whose event is not handled yet', async () => {
    const { session, storage, space } = await signedIn()
    const adopt = session.membershipAdopter()
    const asMember: Membership = { ...acme, role: 'member' }

    // Another tab kept a list naming Acme with another role; its storage event is not handled yet.
    saveMemberships(storage, ann.identity.id, [asMember])

    const lists = followed(space)
    const writes = membershipWrites(storage)

    await adopt(acme)

    expect(writes()).toBe(0)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([asMember])
    expect(lists()).toEqual([[asMember]])
    expect(session.memberships()).toEqual([asMember])

    // The other tab's event comes now, with what the storage holds: nothing changes.
    storage.changeElsewhere(MEMBERSHIPS_KEY, storage.get(MEMBERSHIPS_KEY))
    await settle()

    expect(writes()).toBe(0)
    expect(session.memberships()).toEqual([asMember])
  })

  it('appends the membership to a saved list without it', async () => {
    const { session, storage } = await signedIn()
    const adopt = session.membershipAdopter()

    saveMemberships(storage, ann.identity.id, [globex])

    await adopt(acme)

    expect(savedMemberships(storage, ann.identity.id)).toEqual([globex, acme])
    expect(
      session
        .memberships()
        .map(({ tenant }) => tenant.key)
        .sort(),
    ).toEqual(['acme', 'globex'])
  })

  it('checks, reads, writes and starts the follow with no await between them', async () => {
    const { session, storage, space } = await signedIn()
    const adopt = session.membershipAdopter()
    const order: string[] = []
    const set = storage.set.bind(storage)
    const follow = space.setMemberships.bind(space)

    vi.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === MEMBERSHIPS_KEY) {
        order.push('write')
      }

      set(key, value)
    })
    vi.spyOn(space, 'setMemberships').mockImplementation((next) => {
      order.push('follow')

      return follow(next)
    })

    const adopting = adopt(acme)

    queueMicrotask(() => order.push('yield'))
    await adopting

    expect(order).toEqual(['write', 'follow', 'yield'])
  })

  it('a newer list dropping the organisation before the answer leaves it appended, and the next list removes it', async () => {
    const { session, storage, contexts } = await signedIn({ ...ann, memberships: [acme] })
    const adopt = session.membershipAdopter()
    const channel = contexts()[0] ?? expect.unreachable("the channel of Ann's space")

    expect(session.memberships()).toEqual([acme])

    // The gateway's list without Acme (a removal right after the request) comes before the answer.
    channel.onMemberships([])
    await vi.waitFor(() => expect(session.memberships()).toEqual([]))
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])

    await adopt(acme)

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
    expect(session.memberships()).toEqual([acme])

    channel.onMemberships([])
    await vi.waitFor(() => expect(session.memberships()).toEqual([]))
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
  })

  it('resolves once this tab followed the list it read or wrote, not later lists, and not hanging on an organisation database that fails to open', async () => {
    const { session, storage, space, failures, tenantsOpened } = await signedIn(ann, {
      refusedTenants: ['acme'],
    })
    const adopt = session.membershipAdopter()
    const follow = space.setMemberships.bind(space)
    const lists: Array<readonly Membership[]> = []

    // The list the adopter wrote is followed; every later list is held for good.
    vi.spyOn(space, 'setMemberships').mockImplementation((next) => {
      lists.push(next)

      return lists.length === 1 ? follow(next) : new Promise<void>(() => {})
    })

    const adopting = adopt(acme)

    // Another tab kept a later list meanwhile.
    storage.changeElsewhere(
      MEMBERSHIPS_KEY,
      JSON.stringify({ identity: ann.identity.id, memberships: [acme, globex] }),
    )

    expect(await settledWithin(adopting)).toBe('settled')
    expect(lists).toEqual([[acme], [acme, globex]])
    expect(tenantsOpened()).toEqual([])
    await vi.waitFor(() => expect(failures.map(({ code }) => code)).toEqual(['data:OPEN_FAILED']))
    failures.splice(0)
  })

  it('treats a list adopted here and one heard over the channel alike', async () => {
    const { session, storage, contexts } = await signedIn()
    const channel = contexts()[0] ?? expect.unreachable("the channel of Ann's space")
    const adoptAcme = session.membershipAdopter()
    const adoptAcmeAgain = session.membershipAdopter()
    const adoptGlobex = session.membershipAdopter()
    const writes = membershipWrites(storage)

    // Acme's list was adopted here.
    await adoptAcme(acme)
    expect(writes()).toBe(1)

    await adoptAcmeAgain(acme)
    expect(writes()).toBe(1)

    // Globex's list came over the channel.
    channel.onMemberships([acme, globex])
    await vi.waitFor(() => expect(session.memberships()).toEqual([acme, globex]))
    expect(writes()).toBe(2)

    await adoptGlobex(globex)
    expect(writes()).toBe(2)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme, globex])
  })
})
