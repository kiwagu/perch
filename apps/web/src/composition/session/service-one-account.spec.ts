import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { assertionOf, fakeCeremony } from '../__fixtures__/passkey-ceremony'
import { openTestWorld, type TestWorld, type TestWorldOptions } from '../__fixtures__/session'
import { signedIn, signedInElsewhere } from '../__fixtures__/signed-in'
import type { GatewayAuth } from '../gateway-auth'
import { type KeptDevice, memoryStorage, pendingRevokes, savedIdentity } from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

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

describe('one account per browser', () => {
  it('has a tab with nobody signed in follow a sign-in another tab made', async () => {
    const tab = await world({ online: false })
    const heard: string[] = []

    expect((await tab.session.restore()).isOk()).toBe(true)
    tab.session.subscribe((user) => heard.push(user?.email ?? 'nobody'))

    signedInElsewhere(tab.storage, ann)

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
    signedIn(tab.storage, ann)

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
          signedIn(storage, ann)

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
          signedIn(storage, ann)

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

    signedIn(tab.storage, { identity: annAtGateway, token: 'token-ann' })

    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
    expect(tab.session.current()?.id).toBe(annAtGateway.id)
  })
})

describe('one account per browser at the second doors', () => {
  /** Ann's account with the second factor on, a step its password asked for, and Bob's account. */
  async function annAsksForACode(auth: ReturnType<typeof fakeGatewayAuth>) {
    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    auth.secondFactor(annSignUp.email, '123456')

    const asked = (await auth.signIn(annSignUp, { id: 'device-x', label: 'Edge' }))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    auth.requests.splice(0)

    return { challenge: asked.challenge, email: annSignUp.email }
  }

  it('refuses a code step while another account is signed in on this browser, before it asks the gateway', async () => {
    const auth = fakeGatewayAuth()
    const step = await annAsksForACode(auth)
    const tab = await world({ online: false, auth })

    expect((await tab.session.restore()).isOk()).toBe(true)
    // Another tab signed Bob in; this one has not heard of it yet.
    signedIn(tab.storage, {
      identity: { id: identityIdFactory.create(), email: bobSignUp.email },
      token: 'token-bob',
      memberships: [],
    })

    const refused = await tab.session.confirmSignIn(step, '123456', false)

    expect(refused._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(auth.requests).toEqual([])
    expect(tab.opened()).toEqual([])
  })

  it('lets the code step of the account signed in on this browser go on', async () => {
    const auth = fakeGatewayAuth()
    const step = await annAsksForACode(auth)
    const tab = await world({ online: false, auth })

    signedIn(tab.storage, {
      identity: auth.identityOf(annSignUp.email),
      token: 'token-ann',
      memberships: [],
    })

    expect((await tab.session.confirmSignIn(step, '123456', false))._unsafeUnwrap().kind).toBe(
      'signed-in',
    )
  })

  it('refuses a code step whose answer comes after another tab signed someone else in, and has its new token signed out', async () => {
    const auth = fakeGatewayAuth()
    const step = await annAsksForACode(auth)
    const storage = memoryStorage()
    const late: GatewayAuth = {
      ...auth,
      confirmSignIn: (input, device) =>
        auth.confirmSignIn(input, device).map((answer) => {
          signedIn(storage, {
            identity: { id: identityIdFactory.create(), email: bobSignUp.email },
            token: 'token-bob',
            memberships: [],
          })

          return answer
        }),
    }
    const tab = await world({ storage, auth: late })

    expect((await tab.session.confirmSignIn(step, '123456', false))._unsafeUnwrapErr().code).toBe(
      'data:OTHER_ACCOUNT',
    )
    expect(tab.opened()).toEqual([])
    await vi.waitFor(() =>
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['confirm-sign-in', 'sign-out']),
    )
    expect(pendingRevokes(storage)).toEqual([])
  })

  it('refuses a passkey sign-in while any account is signed in on this browser, before the browser is asked', async () => {
    const auth = fakeGatewayAuth()
    const browser = fakeCeremony(() => okAsync(assertionOf('credential-ann')))

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    const tab = await world({ online: false, auth, ceremony: browser })

    signedIn(tab.storage, ann)

    expect((await tab.session.signInWithPasskey())._unsafeUnwrapErr().code).toBe(
      'data:OTHER_ACCOUNT',
    )
    expect(browser.windows).toBe(0)
    expect(auth.requests).toEqual([])
    expect(tab.opened()).toEqual([])
  })

  it('refuses a passkey sign-in when an account was saved during the ceremony, sending no assertion', async () => {
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)

    const credential = auth.passkeyOf(bobSignUp.email)

    auth.requests.splice(0)

    const storage = memoryStorage()
    // Another tab signs Ann in while the browser's window is open.
    const browser = fakeCeremony(() => {
      signedIn(storage, ann)

      return okAsync(assertionOf(credential))
    })
    const tab = await world({ storage, auth, ceremony: browser })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrapErr().code).toBe(
      'data:OTHER_ACCOUNT',
    )
    expect(browser.windows).toBe(1)
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['passkey-options'])
    expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
    expect(tab.opened()).toEqual([])
  })
})
