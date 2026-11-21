import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { FakeLocks } from '@workspace/replica/testing'

import {
  type FakeGatewayAuth,
  fakeGatewayAuth,
  verifiedElsewhere,
} from '../__fixtures__/gateway-auth'
import { assertionOf, fakeCeremony } from '../__fixtures__/passkey-ceremony'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { sharedStorage } from '../__fixtures__/shared-storage'
import type { GatewayAuth } from '../gateway-auth'
import { pendingRevokes, savedIdentity, savedSession } from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

const CODE = '123456'

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld({ online: false, ...options })

  worlds.push(opened)

  return opened
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Ann's account, with the second factor on, and Bob's, which has none: both verified elsewhere. */
async function accounts(auth: FakeGatewayAuth) {
  const ann = (await verifiedElsewhere(auth, annSignUp))._unsafeUnwrap()
  const bob = (await verifiedElsewhere(auth, bobSignUp))._unsafeUnwrap()

  auth.secondFactor(annSignUp.email, CODE)
  auth.requests.splice(0)

  return { ann, bob }
}

const kinds = (auth: FakeGatewayAuth) => auth.requests.map(({ kind }) => kind)

/** A gateway call the test releases itself, once it was made. */
function held() {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })

  return { released, release: () => release() }
}

/** `auth` with its code step held until `hold` is released: the gateway has the request meanwhile. */
function holdingConfirm(auth: FakeGatewayAuth, hold: ReturnType<typeof held>): GatewayAuth {
  return {
    ...auth,
    confirmSignIn: (step, device) =>
      new ResultAsync(hold.released.then(() => auth.confirmSignIn(step, device))),
  }
}

/** `auth` with its passkey sign-in held until `hold` is released. */
function holdingPasskey(auth: FakeGatewayAuth, hold: ReturnType<typeof held>): GatewayAuth {
  return {
    ...auth,
    signInWithPasskey: (input, device) =>
      new ResultAsync(hold.released.then(() => auth.signInWithPasskey(input, device))),
  }
}

describe('the password step of an account whose second factor is on', () => {
  it('asks for a code with the challenge and the email typed, and keeps nothing: no device is signed in', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({ auth })
    const answer = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (answer.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    expect(answer.challenge).toContain('challenge')
    expect(answer.email).toBe(annSignUp.email)
    expect(kinds(auth)).toEqual(['sign-in'])
    expect(savedSession(tab.storage)).toBeUndefined()
    expect(tab.session.current()).toBeUndefined()
    expect(tab.opened()).toEqual([])
  })

  it('still answers the limit of devices as an outcome, nothing signed in', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)
    auth.atDeviceLimit(bobSignUp.email)

    const tab = await world({ auth })

    expect((await tab.session.signIn(bobSignUp))._unsafeUnwrap()).toEqual({ kind: 'device-limit' })
    expect(savedSession(tab.storage)).toBeUndefined()
  })
})

describe('the code step', () => {
  it('signs the device in with the right code, and opens the account', async () => {
    const auth = fakeGatewayAuth()
    const { ann } = await accounts(auth)
    const tab = await world({ auth })
    const asked = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    const signedIn = (
      await tab.session.confirmSignIn(
        { challenge: asked.challenge, email: asked.email },
        CODE,
        false,
      )
    )._unsafeUnwrap()

    expect(signedIn).toEqual({ kind: 'signed-in', user: ann })
    expect(tab.session.current()).toEqual(ann)
    expect(savedIdentity(tab.storage)).toEqual(ann)
    expect(tab.opened()).toEqual([ann.id])
  })

  it('names the device and the email typed to the gateway, which confirms with the code', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({ auth })
    const asked = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    expect(
      (
        await tab.session.confirmSignIn(
          { challenge: asked.challenge, email: asked.email },
          CODE,
          true,
        )
      ).isOk(),
    ).toBe(true)

    expect(auth.requests[1]).toMatchObject({
      kind: 'confirm-sign-in',
      email: annSignUp.email,
      code: CODE,
      signOutOldest: true,
      device: { label: 'Firefox on Linux' },
    })
  })

  it.each([
    ['a wrong code', 'data:INVALID_CODE'],
    ['a code of a challenge that is dead', 'data:CODE_EXPIRED'],
  ] as const)('keeps nothing and fails as %s', async (way, code) => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({ auth })
    const asked = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    const step =
      way === 'a wrong code'
        ? { challenge: asked.challenge, email: asked.email }
        : { challenge: 'a-challenge-nobody-made', email: asked.email }
    const failed = await tab.session.confirmSignIn(step, '000000', false)

    expect(failed._unsafeUnwrapErr().code).toBe(code)
    expect(savedSession(tab.storage)).toBeUndefined()
    expect(tab.opened()).toEqual([])
  })

  it('answers the limit of devices as an outcome, nothing signed in, and signs in once confirmed from the password', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)
    auth.atDeviceLimit(annSignUp.email)

    const tab = await world({ auth })
    const first = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (first.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    expect(
      (
        await tab.session.confirmSignIn(
          { challenge: first.challenge, email: first.email },
          CODE,
          false,
        )
      )._unsafeUnwrap(),
    ).toEqual({ kind: 'device-limit' })
    expect(savedSession(tab.storage)).toBeUndefined()

    // The right code spent the challenge: the confirmation signs in again from the password.
    const again = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (again.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    expect(
      (
        await tab.session.confirmSignIn(
          { challenge: again.challenge, email: again.email },
          CODE,
          true,
        )
      )._unsafeUnwrap().kind,
    ).toBe('signed-in')
  })

  it('signs a banned account in not at all, nothing kept', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({ auth })
    const asked = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    auth.ban(annSignUp.email)

    expect(
      (
        await tab.session.confirmSignIn(
          { challenge: asked.challenge, email: asked.email },
          CODE,
          false,
        )
      )._unsafeUnwrapErr().code,
    ).toBe('data:ACCOUNT_BANNED')
    expect(savedSession(tab.storage)).toBeUndefined()
  })
})

describe('the passkey sign-in', () => {
  it('has the browser pick a passkey with the gateway’s options, then signs the device in with its assertion', async () => {
    const auth = fakeGatewayAuth()
    const { ann } = await accounts(auth)
    const credential = auth.passkeyOf(annSignUp.email)
    const browser = fakeCeremony(() => okAsync(assertionOf(credential)))
    const tab = await world({ auth, ceremony: browser })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      user: ann,
    })
    expect(browser.windows).toBe(1)
    expect(kinds(auth)).toEqual(['passkey-options', 'passkey-sign-in'])
    expect(auth.requests[0]).toMatchObject({ device: { label: 'Firefox on Linux' } })
    expect(auth.requests[1]).toMatchObject({ credential })
    expect(tab.session.current()).toEqual(ann)
    expect(tab.opened()).toEqual([ann.id])
  })

  it('signs in an account whose second factor is on without asking a code', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({
      auth,
      ceremony: fakeCeremony(() => okAsync(assertionOf(auth.passkeyOf(annSignUp.email)))),
    })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrap().kind).toBe('signed-in')
  })

  it('fails as data:PASSKEY_CANCELLED when the window is closed, sending no assertion', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({
      auth,
      ceremony: fakeCeremony(() => errAsync(dataError('data:PASSKEY_CANCELLED', 'closed'))),
    })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrapErr().code).toBe(
      'data:PASSKEY_CANCELLED',
    )
    expect(kinds(auth)).toEqual(['passkey-options'])
    expect(savedSession(tab.storage)).toBeUndefined()
  })

  it('fails as data:PASSKEY_UNKNOWN for a passkey no account holds, nothing kept', async () => {
    const auth = fakeGatewayAuth()

    await accounts(auth)

    const tab = await world({
      auth,
      ceremony: fakeCeremony(() => okAsync(assertionOf('credential-gone'))),
    })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrapErr().code).toBe(
      'data:PASSKEY_UNKNOWN',
    )
    expect(savedSession(tab.storage)).toBeUndefined()
  })

  it('answers the limit of devices with the account it asked about, and signs in when that account is named again', async () => {
    const auth = fakeGatewayAuth()
    const { ann } = await accounts(auth)
    const credential = auth.passkeyOf(annSignUp.email)

    auth.atDeviceLimit(annSignUp.email)

    const tab = await world({
      auth,
      ceremony: fakeCeremony(() => okAsync(assertionOf(credential))),
    })

    expect((await tab.session.signInWithPasskey())._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
      consentFor: ann.id,
    })
    expect(savedSession(tab.storage)).toBeUndefined()

    // A passkey of another account picked on the confirmation is asked about afresh.
    expect((await tab.session.signInWithPasskey('idn_someone-else'))._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
      consentFor: ann.id,
    })
    expect((await tab.session.signInWithPasskey(ann.id))._unsafeUnwrap().kind).toBe('signed-in')
    expect(auth.requests.at(-1)).toMatchObject({
      kind: 'passkey-sign-in',
      signOutOldestFor: ann.id,
    })
  })
})

describe("the browser's tabs while a second door signs in", () => {
  /** Two tabs of one browser sharing its storage, Web Locks and gateway. */
  async function twoTabs(authOfA: GatewayAuth, authOfB: GatewayAuth, ceremony = fakeCeremony()) {
    const browser = sharedStorage()
    const shared = { locks: new FakeLocks(), databases: browserDatabases() }
    const storage = browser.tab()
    const a = await world({ ...shared, auth: authOfA, storage, ceremony })
    const b = await world({ ...shared, auth: authOfB, storage: browser.tab(), gateway: a.gateway })

    return { a, b, storage }
  }

  it("holds a second tab's sign-in until the code step in flight saved its device: the gateway hears them one after the other, and no device is ended", async () => {
    const auth = fakeGatewayAuth()
    const { ann } = await accounts(auth)
    const hold = held()
    const { a, b, storage } = await twoTabs(holdingConfirm(auth, hold), auth)
    const asked = (await a.session.signIn(annSignUp))._unsafeUnwrap()

    if (asked.kind !== 'code-required') expect.unreachable('the password step asks for a code')

    const confirming = a.session.confirmSignIn(
      { challenge: asked.challenge, email: asked.email },
      CODE,
      false,
    )

    await vi.waitFor(() => expect(a.session.signingInHere()).toBe(true))
    // The second tab signs another account in meanwhile: it waits for the lock.
    const second = b.session.signIn(bobSignUp)

    await settle()
    expect(kinds(auth)).toEqual(['sign-in'])

    hold.release()

    expect((await confirming)._unsafeUnwrap()).toEqual({ kind: 'signed-in', user: ann })
    // Ann is saved by then: Bob's sign-in is refused before the gateway hears of it.
    expect((await second)._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(kinds(auth)).toEqual(['sign-in', 'confirm-sign-in'])
    expect(savedIdentity(storage)).toEqual(ann)
    expect(pendingRevokes(storage)).toEqual([])
  })

  it("holds a second tab's sign-in until the passkey assertion in flight saved its device, and ends no device", async () => {
    const auth = fakeGatewayAuth()
    const { ann } = await accounts(auth)
    const credential = auth.passkeyOf(annSignUp.email)
    const hold = held()
    const { a, b, storage } = await twoTabs(
      holdingPasskey(auth, hold),
      auth,
      fakeCeremony(() => okAsync(assertionOf(credential))),
    )
    const signingIn = a.session.signInWithPasskey()

    await vi.waitFor(() => expect(a.session.signingInHere()).toBe(true))

    const second = b.session.signIn(bobSignUp)

    await settle()
    // The options were asked and the assertion is at the gateway; Bob's sign-in has not been sent.
    expect(kinds(auth)).toEqual(['passkey-options'])

    hold.release()

    expect((await signingIn)._unsafeUnwrap()).toEqual({ kind: 'signed-in', user: ann })
    expect((await second)._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(kinds(auth)).toEqual(['passkey-options', 'passkey-sign-in'])
    expect(savedIdentity(storage)).toEqual(ann)
    expect(pendingRevokes(storage)).toEqual([])
  })

  it("does not hold a second tab's sign-in while the passkey window is open, and then refuses the assertion without sending it", async () => {
    const auth = fakeGatewayAuth()
    const { bob } = await accounts(auth)
    const credential = auth.passkeyOf(annSignUp.email)
    const window = held()
    const { a, b, storage } = await twoTabs(
      auth,
      auth,
      fakeCeremony(() => new ResultAsync(window.released.then(() => ok(assertionOf(credential))))),
    )
    const signingIn = a.session.signInWithPasskey()

    await vi.waitFor(() => expect(kinds(auth)).toEqual(['passkey-options']))
    // The browser's window is open, outside the sign-in lock: another tab signs Bob in.
    expect((await b.session.signIn(bobSignUp))._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      user: bob,
    })

    window.release()

    // The window answers once Bob is saved: nothing is sent, no device of anyone is ended.
    expect((await signingIn)._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(kinds(auth)).toEqual(['passkey-options', 'sign-in'])
    expect(savedIdentity(storage)).toEqual(bob)
    expect(pendingRevokes(storage)).toEqual([])
  })
})
