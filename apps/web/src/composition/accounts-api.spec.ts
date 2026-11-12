import { describe, expect, it, vi } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { fakeFetch, respond } from './__fixtures__/gateway-fetch'
import { sharedStorage } from './__fixtures__/shared-storage'
import { signedIn, signedOut } from './__fixtures__/signed-in'
import { type AccountsDeps, accountsApi } from './accounts-api'
import { SessionRoles } from './session'
import {
  type KeptDevice,
  type MemoryStorage,
  rolesKeyOf,
  savedRoles,
  savedSession,
  saveRoles,
} from './storage'

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

const cara = identityIdFactory.create()

/** Cara's account as the gateway lists it: verified, an operator, never banned. */
const caraListed = {
  id: cara,
  name: 'Cara',
  email: 'cara@example.test',
  emailVerified: true,
  banned: false,
  operator: true,
  createdAt: '2026-10-01T08:00:00.000Z',
}

/** Cara's card as the gateway answers it: never seen, no ban reason, one organisation. */
const caraCard = {
  ...caraListed,
  hasProfile: false,
  lastSeenAt: null,
  banReason: null,
  organisations: [{ key: 'acme', name: 'Acme', role: 'admin' }],
}

/** The client over `fetcher`, asking as Ann with her token, the roles dropped into `dropped`. */
function api(
  fetcher: ReturnType<typeof fakeFetch>['fetcher'],
  overrides: Partial<AccountsDeps> = {},
) {
  const dropped: Array<readonly [IdentityId, PlatformRole]> = []
  const client = accountsApi('/backend', {
    credentials: () => ({ identity: ann.identity.id, token: ann.token, signIn: 'sign-in-ann' }),
    device: () => 'device-1',
    dropRole: (asker, role) => {
      dropped.push([asker.identity, role])
    },
    fetcher,
    ...overrides,
  })

  return { client, dropped }
}

const search = { q: 'car', page: 2, size: 10 } as const

describe('accountsApi', () => {
  it("reads a page of the platform's accounts with the bearer token and the device, its times as dates", async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { accounts: [caraListed], total: 11 }))
    const { client } = api(fetcher)

    expect((await client.list(search))._unsafeUnwrap()).toEqual({
      accounts: [{ ...caraListed, createdAt: new Date('2026-10-01T08:00:00.000Z') }],
      total: 11,
    })
    expect(sent).toEqual([
      {
        url: '/backend/console/accounts?q=car&page=2&size=10',
        method: 'GET',
        authorization: 'Bearer token-ann',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('asks for every account without a search text, sending none', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { accounts: [], total: 0 }))

    expect((await api(fetcher).client.list({ q: '', page: 1, size: 25 })).isOk()).toBe(true)
    expect(sent.map(({ url }) => url)).toEqual(['/backend/console/accounts?page=1&size=25'])
  })

  it('sends the search text as it is typed, encoded', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { accounts: [], total: 0 }))

    expect((await api(fetcher).client.list({ q: ' Ann & co ', page: 1, size: 50 })).isOk()).toBe(
      true,
    )
    expect(sent.map(({ url }) => new URL(url, 'http://x').searchParams.get('q'))).toEqual([
      ' Ann & co ',
    ])
  })

  it('reads one account with its organisations, what it lacks left out', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { account: caraCard }))

    expect((await api(fetcher).client.read(cara))._unsafeUnwrap()).toEqual({
      ...caraListed,
      createdAt: new Date('2026-10-01T08:00:00.000Z'),
      hasProfile: false,
      organisations: [{ key: 'acme', name: 'Acme', role: 'admin' }],
    })
    expect(sent.map(({ url, authorization }) => [url, authorization])).toEqual([
      [`/backend/console/accounts/${cara}`, 'Bearer token-ann'],
    ])
  })

  it('reads when an account was last seen, and why it was banned', async () => {
    const { fetcher } = fakeFetch(
      respond(200, {
        account: {
          ...caraCard,
          banned: true,
          lastSeenAt: '2026-10-18T09:30:00.000Z',
          banReason: 'spam',
        },
      }),
    )

    expect((await api(fetcher).client.read(cara))._unsafeUnwrap()).toMatchObject({
      banned: true,
      lastSeenAt: new Date('2026-10-18T09:30:00.000Z'),
      banReason: 'spam',
    })
  })

  it("fails with each action's own codes: account-gone for a read, not-operator for both", async () => {
    const gone = fakeFetch(respond(404, { code: 'account-gone' }))
    const refused = fakeFetch(respond(403, { code: 'not-operator' }))

    expect((await api(gone.fetcher).client.read(cara))._unsafeUnwrapErr().code).toBe('account-gone')
    expect((await api(refused.fetcher).client.list(search))._unsafeUnwrapErr().code).toBe(
      'not-operator',
    )
    expect((await api(refused.fetcher).client.read(cara))._unsafeUnwrapErr().code).toBe(
      'not-operator',
    )
  })

  it('fails with failed for a code its action does not have, and for an answer of another shape', async () => {
    const badRequest = fakeFetch(respond(400, { code: 'bad-request' }))
    const goneForAList = fakeFetch(respond(404, { code: 'account-gone' }))
    const malformed = fakeFetch(
      respond(200, { accounts: [{ ...caraListed, id: 'cara' }], total: 1 }),
    )

    expect((await api(badRequest.fetcher).client.list(search))._unsafeUnwrapErr().code).toBe(
      'failed',
    )
    expect((await api(goneForAList.fetcher).client.list(search))._unsafeUnwrapErr().code).toBe(
      'failed',
    )
    expect((await api(malformed.fetcher).client.list(search))._unsafeUnwrapErr().code).toBe(
      'failed',
    )
  })

  it('fails with failed on a 401 without a second request, offline, and on a 500, naming no body', async () => {
    const dead = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, { accounts: [], total: 0 }),
    )
    const unreachable = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const broken = fakeFetch(respond(500, { code: 'internal', secret: 'hunter2' }))

    expect((await api(dead.fetcher).client.list(search))._unsafeUnwrapErr().code).toBe('failed')
    expect(dead.sent).toHaveLength(1)
    expect((await api(unreachable.fetcher).client.read(cara))._unsafeUnwrapErr().code).toBe(
      'failed',
    )

    const failure = (await api(broken.fetcher).client.read(cara))._unsafeUnwrapErr()

    expect(failure.code).toBe('failed')
    expect(failure.message).not.toMatch(/hunter2/)
  })

  it('asks nothing while the tab holds no credentials, and fails with failed', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { accounts: [], total: 0 }))
    const { client, dropped } = api(fetcher, { credentials: () => undefined })

    expect((await client.list(search))._unsafeUnwrapErr().code).toBe('failed')
    expect(sent).toEqual([])
    expect(dropped).toEqual([])
  })

  it('takes operator off the roles of the identity that asked on a not-operator, and on nothing else', async () => {
    const refused = api(fakeFetch(respond(403, { code: 'not-operator' })).fetcher)
    const gone = api(fakeFetch(respond(404, { code: 'account-gone' })).fetcher)

    expect((await refused.client.read(cara))._unsafeUnwrapErr().code).toBe('not-operator')
    expect((await gone.client.read(cara))._unsafeUnwrapErr().code).toBe('account-gone')

    expect(refused.dropped).toEqual([[ann.identity.id, 'operator']])
    expect(gone.dropped).toEqual([])
  })
})

/** A `fetch` whose one answer waits until the test lets it go. */
function heldFetch(answer: () => Promise<Response>) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const { fetcher, sent } = fakeFetch(() => released.then(answer))

  return { fetcher, sent, release }
}

/** The credentials a tab showing `shown()` reads from its storage, as the composition root does. */
const credentialsOf = (storage: MemoryStorage, shown: () => IdentityId | undefined) => () => {
  const identity = shown()
  const saved = savedSession(storage)

  return identity !== undefined && saved?.identity === identity
    ? { identity, token: saved.token, signIn: saved.signIn }
    : undefined
}

describe('a not-operator answered after the browser changed accounts', () => {
  it("takes operator off the record of the identity that asked, and leaves the identity now signed in alone, in this tab's storage and another's", async () => {
    const browser = sharedStorage()
    const here = browser.tab()
    const other = browser.tab()
    let shown: IdentityId | undefined = ann.identity.id

    const annSession = signedIn(here, ann)

    saveRoles(here, annSession, ['operator'])

    const roles = new SessionRoles({ storage: here, shown: () => shown })
    const told = vi.fn()

    roles.subscribe(told)

    const held = heldFetch(respond(403, { code: 'not-operator' }))
    const client = accountsApi('/backend', {
      credentials: credentialsOf(here, () => shown),
      device: () => 'device-1',
      dropRole: (asker, role) => roles.drop(asker, role),
      fetcher: held.fetcher,
    })
    const asked = client.list(search)

    // Another tab signs Ann out and Bob in, an operator; this tab follows and shows Bob.
    const bobSession = signedIn(other, bob)

    saveRoles(other, bobSession, ['operator'])
    shown = bob.identity.id

    held.release()

    expect((await asked)._unsafeUnwrapErr().code).toBe('not-operator')
    expect(held.sent.map(({ authorization }) => authorization)).toEqual(['Bearer token-ann'])
    expect(savedRoles(here, annSession)).toEqual([])
    expect(savedRoles(here, bobSession)).toEqual(['operator'])
    expect(savedRoles(other, bobSession)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(told).toHaveBeenCalled()
  })

  it("leaves the operator role of the same account's later sign-in alone", async () => {
    const browser = sharedStorage()
    const here = browser.tab()
    const other = browser.tab()
    const first = signedIn(here, ann)

    saveRoles(here, first, ['operator'])

    const roles = new SessionRoles({ storage: here, shown: () => ann.identity.id })
    const held = heldFetch(respond(403, { code: 'not-operator' }))
    const client = accountsApi('/backend', {
      credentials: credentialsOf(here, () => ann.identity.id),
      device: () => 'device-1',
      dropRole: (asker, role) => roles.drop(asker, role),
      fetcher: held.fetcher,
    })
    const asked = client.list(search)

    // Another tab signs Ann out and in again, an operator again by then; its welcome kept that.
    signedOut(other)

    const again = signedIn(other, { ...ann, token: 'token-ann-again' })

    saveRoles(other, again, ['operator'])
    held.release()

    expect((await asked)._unsafeUnwrapErr().code).toBe('not-operator')
    expect(savedRoles(here, again)).toEqual(['operator'])
    expect(savedRoles(other, again)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
  })

  it('creates no record for an identity that had none', async () => {
    const browser = sharedStorage()
    const here = browser.tab()

    const session = signedIn(here, ann)

    const roles = new SessionRoles({ storage: here, shown: () => ann.identity.id })
    const client = accountsApi('/backend', {
      credentials: credentialsOf(here, () => ann.identity.id),
      device: () => 'device-1',
      dropRole: (asker, role) => roles.drop(asker, role),
      fetcher: fakeFetch(respond(403, { code: 'not-operator' })).fetcher,
    })

    expect((await client.read(cara))._unsafeUnwrapErr().code).toBe('not-operator')
    expect(here.get(rolesKeyOf(session.signIn))).toBeUndefined()
  })
})
