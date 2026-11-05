import { afterEach, describe, expect, it } from 'vitest'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { openTestWorld, signUpVerified, type TestWorld } from '../__fixtures__/session'
import { savedIdentity, savedToken } from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Secret-ann1', name: 'Ann', locale: 'en' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

/** A browser where Ann is signed in, the gateway's record of the requests emptied. */
async function signedIn() {
  const auth = fakeGatewayAuth()
  const world = await openTestWorld({ auth, online: false })

  worlds.push(world)
  expect((await signUpVerified(world.session, auth, annSignUp)).isOk()).toBe(true)
  auth.requests.splice(0)

  return { ...world, auth }
}

describe("asking to delete the signed-in account's", () => {
  it('asks the gateway with the session this device holds, and stays signed in', async () => {
    const { session, auth, storage } = await signedIn()
    const token = savedToken(storage)
    const device = storage.get('perch.device.id')

    expect((await session.requestAccountDeletion(annSignUp.password)).isOk()).toBe(true)
    expect(auth.requests).toEqual([{ kind: 'request-deletion', token, device }])
    expect(session.current()?.email).toBe(annSignUp.email)
  })

  it('keeps the refusal of a wrong password, and the account as it is', async () => {
    const { session, auth } = await signedIn()

    expect((await session.requestAccountDeletion('Wrong-pass1'))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CREDENTIALS',
    )
    expect(() => auth.deletionLinkFor(annSignUp.email)).toThrow()
  })

  it('keeps the refusal of the only administrator of an organisation with other members', async () => {
    const { session, auth } = await signedIn()

    auth.blockDeletion(annSignUp.email)

    expect((await session.requestAccountDeletion(annSignUp.password))._unsafeUnwrapErr().code).toBe(
      'data:LAST_ADMIN',
    )
    expect(() => auth.deletionLinkFor(annSignUp.email)).toThrow()
  })

  it('asks nothing while nobody is signed in on this device', async () => {
    const auth = fakeGatewayAuth()
    const world = await openTestWorld({ auth, online: false })

    worlds.push(world)

    expect(
      (await world.session.requestAccountDeletion('Secret-ann1'))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
    expect(auth.requests).toEqual([])
  })
})

describe("the deletion of an account by its mailed link's", () => {
  it('asks the gateway alone, with no session, and the account is gone for good', async () => {
    const { session, auth } = await signedIn()

    expect((await session.requestAccountDeletion(annSignUp.password)).isOk()).toBe(true)
    auth.requests.splice(0)

    const link = auth.deletionLinkFor(annSignUp.email)

    expect((await session.deleteAccount(link)).isOk()).toBe(true)
    expect(auth.requests).toEqual([{ kind: 'delete', token: link }])
    expect((await auth.signIn(annSignUp, { id: 'ann-2', label: 'Edge on Windows' })).isErr()).toBe(
      true,
    )
  })

  it('signs this browser out of the account it deleted, with no channel to hear the gateway', async () => {
    const { session, auth, storage } = await signedIn()

    expect((await session.requestAccountDeletion(annSignUp.password)).isOk()).toBe(true)
    expect((await session.deleteAccount(auth.deletionLinkFor(annSignUp.email))).isOk()).toBe(true)

    // As the channel's 4001 would have left it: nobody here, the token forgotten, the word set.
    expect(session.current()).toBeUndefined()
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedToken(storage)).toBeUndefined()
    expect(session.notice()).toBe('signed-out-elsewhere')
  })

  it('leaves another account signed in here alone', async () => {
    const { session, auth, storage } = await signedIn()
    const me = session.current() ?? expect.unreachable('signed in')
    const bob = { email: 'bob@example.test', password: 'Secret-bob1', name: 'Bob', locale: 'en' }

    expect((await verifiedElsewhere(auth, bob)).isOk()).toBe(true)

    // Bob asks on his own device, and his link is opened in Ann's browser.
    const bobSession = (
      await auth.signIn(bob, { id: 'bob-device', label: 'Edge on Windows' })
    )._unsafeUnwrap()

    expect(
      (
        await auth.requestAccountDeletion(bob.password, {
          token: bobSession.token,
          device: 'bob-device',
        })
      ).isOk(),
    ).toBe(true)
    expect((await session.deleteAccount(auth.deletionLinkFor(bob.email))).isOk()).toBe(true)
    expect(session.current()?.id).toBe(me.id)
    expect(savedIdentity(storage)?.id).toBe(me.id)
    expect(savedToken(storage)).toBeDefined()
    expect(session.notice()).toBeUndefined()
  })

  it('changes nothing here when nobody is signed in', async () => {
    const auth = fakeGatewayAuth()
    const world = await openTestWorld({ auth, online: false })

    worlds.push(world)
    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

    const ann = (
      await auth.signIn(annSignUp, { id: 'ann-device', label: 'Edge on Windows' })
    )._unsafeUnwrap()

    expect(
      (
        await auth.requestAccountDeletion(annSignUp.password, {
          token: ann.token,
          device: 'ann-device',
        })
      ).isOk(),
    ).toBe(true)
    expect((await world.session.deleteAccount(auth.deletionLinkFor(annSignUp.email))).isOk()).toBe(
      true,
    )
    expect(world.session.current()).toBeUndefined()
    expect(world.session.notice()).toBeUndefined()
    expect(savedIdentity(world.storage)).toBeUndefined()
  })

  it('refuses the link a second time as one that does not work', async () => {
    const { session, auth } = await signedIn()

    expect((await session.requestAccountDeletion(annSignUp.password)).isOk()).toBe(true)

    const link = auth.deletionLinkFor(annSignUp.email)

    expect((await session.deleteAccount(link)).isOk()).toBe(true)
    expect((await session.deleteAccount(link))._unsafeUnwrapErr().code).toBe('data:LINK_INVALID')
  })

  it('keeps the refusal of the only administrator, the link working once the block is gone', async () => {
    const { session, auth } = await signedIn()

    expect((await session.requestAccountDeletion(annSignUp.password)).isOk()).toBe(true)

    const link = auth.deletionLinkFor(annSignUp.email)

    auth.blockDeletion(annSignUp.email)

    expect((await session.deleteAccount(link))._unsafeUnwrapErr().code).toBe('data:LAST_ADMIN')

    auth.blockDeletion(annSignUp.email, false)

    expect((await session.deleteAccount(link)).isOk()).toBe(true)
  })

  it('refuses a link nobody was mailed', async () => {
    const { session } = await signedIn()

    expect((await session.deleteAccount('deletion-unknown'))._unsafeUnwrapErr().code).toBe(
      'data:LINK_INVALID',
    )
  })
})
