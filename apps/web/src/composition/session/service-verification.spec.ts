import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import { FakeLocks } from '@workspace/replica/testing'

import { type FakeGatewayAuth, fakeGatewayAuth } from '../__fixtures__/gateway-auth'
import {
  openTestWorld,
  TEST_DEVICE_LABEL,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import {
  deviceIdFrom,
  type KeptDevice,
  pendingRevokes,
  saveDevice,
  savedIdentity,
  savedToken,
} from '../storage'

import { SIGN_IN_LOCK } from './sign-in'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

/** Carol, signed in on this browser by another tab. */
const carol: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'carol@example.test' },
  token: 'token-carol',
  memberships: [],
}

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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** An account signed up at the gateway elsewhere: its link is the latest it was mailed. */
async function signedUp(auth: FakeGatewayAuth, input = annSignUp): Promise<AuthUser> {
  expect((await auth.signUp(input)).isOk()).toBe(true)

  return auth.identityOf(input.email)
}

describe('verifying an email', () => {
  it('signs this device in the first time: the token kept, the memberships read with it, the space open', async () => {
    const auth = fakeGatewayAuth()
    const ann = await signedUp(auth)
    const reads: Array<{ readonly token: string; readonly device: string }> = []
    const tab = await world({
      auth,
      online: false,
      listMemberships: (token, device) => {
        reads.push({ token, device })

        return okAsync([])
      },
    })
    const link = auth.linkFor(annSignUp.email)

    expect((await tab.session.verifyEmail(link))._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      user: ann,
    })
    // The account has not started: its start is kept, from the name and language it signed up with.
    expect(tab.startsKept).toEqual([[ann, { name: 'Ann', locale: 'en' }]])

    const device = deviceIdFrom(tab.storage)

    // The exchange names this device, as a sign-in does; the gateway's answer is its new token.
    expect(auth.requests.at(-1)).toEqual({
      kind: 'verify',
      token: link,
      device: { id: device, label: TEST_DEVICE_LABEL },
    })
    expect(tab.session.current()).toEqual(ann)
    expect(savedIdentity(tab.storage)).toEqual(ann)
    expect(savedToken(tab.storage)).toBe('token-1')
    expect(reads).toEqual([{ token: 'token-1', device }])
    expect(tab.opened()).toEqual([ann.id])
  })

  it('answers a link verified before as such, and changes nothing', async () => {
    const auth = fakeGatewayAuth()
    const ann = await signedUp(auth)
    const link = auth.linkFor(annSignUp.email)
    const tab = await world({ auth, online: false })

    expect((await tab.session.verifyEmail(link)).isOk()).toBe(true)

    // Opened again on this browser: Ann's session stays as it was.
    expect((await tab.session.verifyEmail(link))._unsafeUnwrap()).toEqual({
      kind: 'verified-before',
    })
    expect(tab.session.current()).toEqual(ann)
    expect(savedToken(tab.storage)).toBe('token-1')
    expect(tab.opened()).toEqual([ann.id])

    // Opened on another browser, where nobody is signed in: nobody is still.
    const other = await world({ auth, online: false })

    expect((await other.session.verifyEmail(link))._unsafeUnwrap()).toEqual({
      kind: 'verified-before',
    })
    expect(other.session.current()).toBeUndefined()
    expect(savedIdentity(other.storage)).toBeUndefined()
    expect(other.opened()).toEqual([])
  })

  it('refuses a first verification while another account is signed in on this browser, and has its new token signed out', async () => {
    const auth = fakeGatewayAuth()

    await signedUp(auth, bobSignUp)

    const tab = await world({ auth })

    expect((await tab.session.restore()).isOk()).toBe(true)
    // Another tab signed Carol in; this one has not heard of it yet.
    saveDevice(tab.storage, carol)

    const refused = await tab.session.verifyEmail(auth.linkFor(bobSignUp.email))

    expect(refused._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(savedIdentity(tab.storage)).toEqual(carol.identity)
    expect(savedToken(tab.storage)).toBe('token-carol')
    expect(tab.opened()).toEqual([])
    // Bob's new token goes to the gateway to be signed out at once: the browser is online.
    await vi.waitFor(() =>
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-up', 'verify', 'sign-out']),
    )
    expect(auth.requests[2]).toMatchObject({ kind: 'sign-out', token: 'token-1' })
    expect(pendingRevokes(tab.storage)).toEqual([])
  })

  it('refuses a link without a token', async () => {
    const tab = await world({ online: false })

    expect((await tab.session.verifyEmail(''))._unsafeUnwrapErr().code).toBe('data:LINK_INVALID')
    expect(tab.session.current()).toBeUndefined()
    expect(savedIdentity(tab.storage)).toBeUndefined()
    expect(tab.opened()).toEqual([])
  })

  it("asks the gateway only once another tab's sign-in let go of the browser's sign-in lock", async () => {
    const auth = fakeGatewayAuth()
    const ann = await signedUp(auth)
    const locks = new FakeLocks()
    let release = () => {}
    // Another tab's sign-in holds the lock.
    const held = locks.request(
      SIGN_IN_LOCK,
      { mode: 'exclusive' },
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const tab = await world({ auth, locks, online: false })
    const verifying = tab.session.verifyEmail(auth.linkFor(annSignUp.email))

    await settle()
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-up'])

    release()
    await held

    expect((await verifying)._unsafeUnwrap()).toMatchObject({ kind: 'signed-in', user: ann })
  })
})

describe('signing up', () => {
  it('asks the gateway with the name and the language, and signs nothing in', async () => {
    const auth = fakeGatewayAuth()
    const tab = await world({ auth, online: false })

    expect(
      (await tab.session.signUp({ ...annSignUp, locale: 'es' }))._unsafeUnwrap(),
    ).toBeUndefined()
    expect(auth.requests).toEqual([
      { kind: 'sign-up', email: annSignUp.email, name: 'Ann', locale: 'es' },
    ])
    expect(tab.session.current()).toBeUndefined()
    expect(savedIdentity(tab.storage)).toBeUndefined()
    expect(savedToken(tab.storage)).toBeUndefined()
    expect(tab.opened()).toEqual([])
    // Until its link is opened, the account signs in nowhere; a wrong password still says so.
    expect((await tab.session.signIn(annSignUp))._unsafeUnwrapErr().code).toBe(
      'data:EMAIL_NOT_VERIFIED',
    )
    expect(
      (await tab.session.signIn({ ...annSignUp, password: 'wrong-password' }))._unsafeUnwrapErr()
        .code,
    ).toBe('data:INVALID_CREDENTIALS')
  })

  it('answers an email that has an account as a new one, and changes nothing of that account', async () => {
    const auth = fakeGatewayAuth()
    const tab = await world({ auth, online: false })

    expect((await tab.session.signUp(annSignUp)).isOk()).toBe(true)

    const link = auth.linkFor(annSignUp.email)
    const again = { ...annSignUp, password: 'Other-pass-word-1', name: 'Other' }

    expect((await tab.session.signUp(again))._unsafeUnwrap()).toBeUndefined()
    // No new link, and the account keeps its password and its name.
    expect(auth.linkFor(annSignUp.email)).toBe(link)
    expect((await tab.session.verifyEmail(link))._unsafeUnwrap()).toMatchObject({
      kind: 'signed-in',
    })
    expect(tab.startsKept).toMatchObject([[{ email: annSignUp.email }, { name: 'Ann' }]])
    expect((await tab.session.signOut()).isOk()).toBe(true)
    expect((await tab.session.signIn(again))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CREDENTIALS',
    )
    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
  })
})

describe('resending the verification mail', () => {
  it('asks the gateway once and changes nothing in the session', async () => {
    const auth = fakeGatewayAuth()

    await signedUp(auth)

    const first = auth.linkFor(annSignUp.email)
    const tab = await world({ auth, online: false })

    expect((await tab.session.resendVerification(annSignUp.email)).isOk()).toBe(true)
    expect(auth.requests.slice(1)).toEqual([{ kind: 'resend', email: annSignUp.email }])
    // The gateway mailed a new link.
    expect(auth.linkFor(annSignUp.email)).not.toBe(first)
    expect(tab.session.current()).toBeUndefined()
    expect(savedIdentity(tab.storage)).toBeUndefined()
    expect(tab.opened()).toEqual([])
  })
})
