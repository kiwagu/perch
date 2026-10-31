import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { openTestWorld, type TestWorld, type TestWorldOptions } from '../__fixtures__/session'
import type { GatewayAuth } from '../gateway-auth'
import {
  type KeptDevice,
  type MemoryStorage,
  memoryStorage,
  pendingRevokes,
  saveDevice,
  savedIdentity,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annSignUp = { email: 'ann@example.test', password: 'pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'pass-word-2', name: 'Bob', locale: 'en' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/** Another tab of the browser signs `device` in: this tab hears each key it writes, in order. */
function signInElsewhere(storage: MemoryStorage, device: KeptDevice): void {
  const other = memoryStorage()

  saveDevice(other, device)

  for (const key of [
    'perch.session.token',
    'perch.session.identity',
    'perch.session.memberships',
  ]) {
    storage.changeElsewhere(key, other.get(key))
  }
}

describe('one account per browser', () => {
  it('has a tab with nobody signed in follow a sign-in another tab made', async () => {
    const tab = await world({ online: false })
    const heard: string[] = []

    expect((await tab.session.restore()).isOk()).toBe(true)
    tab.session.subscribe((user) => heard.push(user?.email ?? 'nobody'))

    signInElsewhere(tab.storage, ann)

    await vi.waitFor(() => expect(tab.session.current()?.id).toBe(ann.identity.id))
    expect(heard).toEqual([ann.identity.email])
    expect(tab.opened()).toEqual([ann.identity.id])
  })

  it('refuses a sign-in while another account is signed in on this browser, before it asks the gateway', async () => {
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    const tab = await world({ online: false, auth })

    expect((await tab.session.restore()).isOk()).toBe(true)
    // Another tab signed Ann in; this one has not heard of it yet.
    saveDevice(tab.storage, ann)

    const refused = await tab.session.signIn(bobSignUp)

    expect(refused._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(auth.requests).toEqual([])
    expect(savedIdentity(tab.storage)?.id).toBe(ann.identity.id)
    expect(tab.opened()).toEqual([])
  })

  it('refuses a sign-in whose answer comes after another tab signed someone else in, and has its new token signed out', async () => {
    const auth = fakeGatewayAuth()
    const storage = memoryStorage()

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    // The gateway answers once another tab has signed Ann in.
    const late: GatewayAuth = {
      ...auth,
      signIn: (input, device) =>
        auth.signIn(input, device).map((answer) => {
          saveDevice(storage, ann)

          return answer
        }),
    }
    const tab = await world({ storage, auth: late })

    const refused = await tab.session.signIn(bobSignUp)

    expect(refused._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
    expect(tab.opened()).toEqual([])
    // Bob's new token goes to the gateway to be signed out at once: the browser is online.
    await vi.waitFor(() =>
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-out']),
    )
    // The token of the link opened elsewhere was the first; this sign-in's is the second.
    expect(auth.requests[1]).toMatchObject({ kind: 'sign-out', token: 'token-2' })
    expect(pendingRevokes(storage)).toEqual([])
  })

  it('keeps the new token of a refused sign-in to sign out later while offline', async () => {
    const auth = fakeGatewayAuth()
    const storage = memoryStorage()

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    const late: GatewayAuth = {
      ...auth,
      signIn: (input, device) =>
        auth.signIn(input, device).map((answer) => {
          saveDevice(storage, ann)

          return answer
        }),
    }
    const tab = await world({ storage, auth: late, online: false })

    expect((await tab.session.signIn(bobSignUp))._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(pendingRevokes(storage)).toHaveLength(1)
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])
  })

  it('lets the account signed in on this browser sign in again', async () => {
    const auth = fakeGatewayAuth()
    const tab = await world({ online: false, auth })
    const annAtGateway = (await verifiedElsewhere(auth, annSignUp))._unsafeUnwrap()

    saveDevice(tab.storage, { identity: annAtGateway, token: 'token-ann', memberships: [] })

    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
    expect(tab.session.current()?.id).toBe(annAtGateway.id)
  })
})
