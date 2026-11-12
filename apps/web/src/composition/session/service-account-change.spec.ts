import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import {
  browserDatabases,
  openTestWorld,
  signUpVerified,
  type TestWorld,
} from '../__fixtures__/session'
import { signedIn as signedInOn, signedOut } from '../__fixtures__/signed-in'
import {
  type MemoryStorage,
  memoryStorage,
  newSignInId,
  savedIdentity,
  savedToken,
  signedInKeyOf,
} from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Secret-ann1', name: 'Ann', locale: 'en' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

async function signedIn() {
  const auth = fakeGatewayAuth()
  const world = await openTestWorld({ auth, online: false })

  worlds.push(world)
  expect((await signUpVerified(world.session, auth, annSignUp)).isOk()).toBe(true)
  auth.requests.splice(0)

  return { ...world, auth }
}

/**
 * Ann signed up in this browser, whose page then loads again: the start opens her space, and her
 * database opens only once the test lets it (`open`).
 */
async function annOpening() {
  const auth = fakeGatewayAuth()
  const storage = memoryStorage()
  const before = await openTestWorld({ auth, storage, online: false })

  expect((await signUpVerified(before.session, auth, annSignUp)).isOk()).toBe(true)
  await before.close()
  expect(before.failures).toEqual([])
  auth.requests.splice(0)

  let open: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    open = resolve
  })
  const shared = browserDatabases()
  const tab = await openTestWorld({
    auth,
    storage,
    online: false,
    databases: {
      open: (identity) => ResultAsync.fromSafePromise(held).andThen(() => shared.open(identity)),
    },
  })

  worlds.push(tab)

  const restoring = tab.session.restore()

  expect(tab.session.current()?.email).toBe(annSignUp.email)
  expect(tab.session.space()).toBeUndefined()

  return { auth, storage, session: tab.session, open, restoring }
}

describe("a change of the signed-in account's password or email", () => {
  it('asks the gateway with the session this device holds, and stays signed in', async () => {
    const { session, auth, storage } = await signedIn()
    const token = savedToken(storage)
    const device = storage.get('perch.device.id')

    expect((await session.changePassword(annSignUp.password, 'Secret-new1')).isOk()).toBe(true)
    expect((await session.changeEmail('ann.new@example.test', 'Secret-new1')).isOk()).toBe(true)
    expect(auth.requests).toEqual([
      { kind: 'change-password', token, device },
      { kind: 'change-email', email: 'ann.new@example.test', token },
    ])
    expect(session.current()?.email).toBe(annSignUp.email)
  })

  it('keeps the gateway refusal', async () => {
    const { session } = await signedIn()

    expect(
      (await session.changePassword('Wrong-pass1', 'Secret-new1'))._unsafeUnwrapErr().code,
    ).toBe('data:INVALID_CREDENTIALS')
  })

  it('asks nothing while nobody is signed in on this device', async () => {
    const auth = fakeGatewayAuth()
    const world = await openTestWorld({ auth, online: false })

    worlds.push(world)

    expect(
      (await world.session.changePassword('Secret-ann1', 'Secret-new1'))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
    expect(auth.requests).toEqual([])
  })

  it("asks the gateway with the session this device saved while the start opens the account's space", async () => {
    const { auth, storage, session, open, restoring } = await annOpening()

    expect((await session.changePassword(annSignUp.password, 'Secret-new1')).isOk()).toBe(true)
    expect(auth.requests).toEqual([
      {
        kind: 'change-password',
        token: savedToken(storage),
        device: storage.get('perch.device.id'),
      },
    ])

    open()

    expect((await restoring).isOk()).toBe(true)
  })

  it.each([
    [
      'signed Ann out and Bob in',
      (storage: MemoryStorage) => {
        signedInOn(storage, {
          identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
          token: 'token-bob',
        })
      },
    ],
    [
      "signed Ann out and wrote Bob's sign-in, not yet made it current",
      (storage: MemoryStorage) => {
        signedOut(storage)
        storage.set(
          signedInKeyOf(newSignInId()),
          JSON.stringify({
            identity: identityIdFactory.create(),
            email: 'bob@example.test',
            token: 'token-bob',
          }),
        )
      },
    ],
  ])(
    "asks nothing with another account's session that another tab saved while the space opens: it %s",
    async (_, saved) => {
      const { auth, storage, session, open, restoring } = await annOpening()

      // This tab follows once its start is done.
      saved(storage)

      const asked = [
        await session.changePassword(annSignUp.password, 'Secret-new1'),
        await session.changeEmail('ann.new@example.test', annSignUp.password),
        await session.requestAccountDeletion(annSignUp.password),
      ]

      expect(asked.map((answer) => answer._unsafeUnwrapErr().code)).toEqual([
        'data:AUTH_FAILED',
        'data:AUTH_FAILED',
        'data:AUTH_FAILED',
      ])
      expect(auth.requests).toEqual([])

      open()

      expect((await restoring).isOk()).toBe(true)
    },
  )
})

describe('the confirmation of a new email', () => {
  it('keeps the new email of the account signed in here, signing nothing in or out', async () => {
    const { session, auth, storage } = await signedIn()
    const me = session.current() ?? expect.unreachable('signed in')

    expect((await session.changeEmail('Ann.New@example.test', annSignUp.password)).isOk()).toBe(
      true,
    )

    const confirmed = await session.confirmEmail(auth.confirmationLinkFor(annSignUp.email))

    expect(confirmed._unsafeUnwrap()).toEqual({ identity: me.id, email: 'ann.new@example.test' })
    expect(savedIdentity(storage)).toEqual({ id: me.id, email: 'ann.new@example.test' })
    expect(session.current()?.id).toBe(me.id)
  })

  it("leaves the browser's account alone when another account's email changed", async () => {
    const { session, auth, storage } = await signedIn()
    const me = session.current() ?? expect.unreachable('signed in')
    const bob = { email: 'bob@example.test', password: 'Secret-bob1', name: 'Bob', locale: 'en' }

    expect((await verifiedElsewhere(auth, bob)).isOk()).toBe(true)

    // Bob asks for the change on his own device, and his link is opened in Ann's browser.
    const bobDevice = await auth.signIn(bob, { id: 'bob-device', label: 'Edge on Windows' })
    const bobSession = bobDevice._unsafeUnwrap()

    expect(
      (
        await auth.changeEmail(
          { email: 'bob.new@example.test', password: bob.password },
          { token: bobSession.token, device: 'bob-device' },
        )
      ).isOk(),
    ).toBe(true)
    expect((await session.confirmEmail(auth.confirmationLinkFor(bob.email))).isOk()).toBe(true)
    expect(savedIdentity(storage)).toEqual({ id: me.id, email: annSignUp.email })
  })

  it('changes nothing of a later sign-in of the account: a confirmation changes the sign-in it was asked in', async () => {
    const { session, auth, storage, driveClock } = await signedIn()

    expect((await session.changeEmail('Ann.New@example.test', annSignUp.password)).isOk()).toBe(
      true,
    )

    // The gateway takes the link only once this browser has signed Ann out and in again.
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const confirm = auth.confirmEmail.bind(auth)

    auth.confirmEmail = (link) => ResultAsync.fromSafePromise(answered).andThen(() => confirm(link))

    const confirming = session.confirmEmail(auth.confirmationLinkFor(annSignUp.email))

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect((await session.signIn(annSignUp)).isOk()).toBe(true)
    answer()

    expect((await confirming).isOk()).toBe(true)
    // The later sign-in's email stands; the next one reads the email the gateway has then.
    expect(savedIdentity(storage)?.email).toBe(annSignUp.email)
  })

  it('changes nothing of a session signed in after a confirmation asked while signed out', async () => {
    const { session, auth, storage, driveClock } = await signedIn()

    expect((await session.changeEmail('Ann.New@example.test', annSignUp.password)).isOk()).toBe(
      true,
    )
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    // The link is opened while nobody is signed in here; the gateway takes it once Ann signed in.
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const confirm = auth.confirmEmail.bind(auth)

    auth.confirmEmail = (link) => ResultAsync.fromSafePromise(answered).andThen(() => confirm(link))

    const confirming = session.confirmEmail(auth.confirmationLinkFor(annSignUp.email))

    expect((await session.signIn(annSignUp)).isOk()).toBe(true)
    answer()

    expect((await confirming).isOk()).toBe(true)
    expect(savedIdentity(storage)?.email).toBe(annSignUp.email)
  })

  it('keeps the refusal of a link that does not work', async () => {
    const { session } = await signedIn()

    expect((await session.confirmEmail('confirm-unknown'))._unsafeUnwrapErr().code).toBe(
      'data:LINK_INVALID',
    )
  })
})
