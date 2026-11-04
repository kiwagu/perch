import { afterEach, describe, expect, it } from 'vitest'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { openTestWorld, signUpVerified, type TestWorld } from '../__fixtures__/session'
import { PASSWORD_RESET_KEY, savedIdentity } from '../storage'

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

const email = 'ann@example.test'

/** A guest tab of a browser where Ann asked for the mail of a reset. */
async function resetAsked() {
  const auth = fakeGatewayAuth()
  const world = await openTestWorld({ auth, online: false })

  worlds.push(world)
  expect(
    (await auth.signUp({ email, password: 'Secret-ann1', name: 'Ann', locale: 'en' })).isOk(),
  ).toBe(true)
  expect((await world.session.requestPasswordReset(email)).isOk()).toBe(true)

  return { auth, world }
}

describe('a password reset through the session', () => {
  it("tells the browser's other tabs once the gateway set the new password, anew each time", async () => {
    const { auth, world } = await resetAsked()

    expect(world.storage.get(PASSWORD_RESET_KEY)).toBeUndefined()
    expect(
      (await world.session.resetPassword(auth.resetLinkFor(email), 'Secret-new1')).isOk(),
    ).toBe(true)

    const first = world.storage.get(PASSWORD_RESET_KEY)

    expect(first).toBeDefined()

    expect((await world.session.requestPasswordReset(email)).isOk()).toBe(true)
    expect(
      (await world.session.resetPassword(auth.resetLinkFor(email), 'Secret-new2')).isOk(),
    ).toBe(true)
    expect(world.storage.get(PASSWORD_RESET_KEY)).not.toBe(first)
  })

  it('tells nothing when the gateway refused the link', async () => {
    const { world } = await resetAsked()

    expect((await world.session.resetPassword('reset-unknown', 'Secret-new1')).isErr()).toBe(true)
    expect(world.storage.get(PASSWORD_RESET_KEY)).toBeUndefined()
  })
})

const ann = { email, password: 'Secret-ann1', name: 'Ann', locale: 'en' }

/** A browser where Ann is signed in, with no channel to hear the gateway (offline). */
async function signedIn() {
  const auth = fakeGatewayAuth()
  const world = await openTestWorld({ auth, online: false })

  worlds.push(world)
  expect((await signUpVerified(world.session, auth, ann)).isOk()).toBe(true)

  return { auth, world }
}

describe('a password reset in a browser signed in', () => {
  it('signs this browser out of its own account, with no channel to hear the gateway', async () => {
    const { auth, world } = await signedIn()

    expect((await auth.requestPasswordReset(email)).isOk()).toBe(true)
    expect(
      (await world.session.resetPassword(auth.resetLinkFor(email), 'Secret-new1')).isOk(),
    ).toBe(true)

    // As the channel's 4002 would have left it: nobody here, the token forgotten, the word set.
    expect(world.session.current()).toBeUndefined()
    expect(savedIdentity(world.storage)).toBeUndefined()
    expect(world.storage.get('perch.session.token')).toBeUndefined()
    expect(world.session.notice()).toBe('password-changed-elsewhere')
  })

  it('leaves another account signed in here alone', async () => {
    const { auth, world } = await signedIn()
    const me = world.session.current() ?? expect.unreachable('signed in')
    const bob = { email: 'bob@example.test', password: 'Secret-bob1', name: 'Bob', locale: 'en' }

    // Bob asks for his reset mail, and its link is opened in Ann's browser.
    expect((await verifiedElsewhere(auth, bob)).isOk()).toBe(true)
    expect((await auth.requestPasswordReset(bob.email)).isOk()).toBe(true)
    expect(
      (await world.session.resetPassword(auth.resetLinkFor(bob.email), 'Secret-new1')).isOk(),
    ).toBe(true)

    expect(world.session.current()?.id).toBe(me.id)
    expect(savedIdentity(world.storage)?.id).toBe(me.id)
    expect(world.storage.get('perch.session.token')).toBeDefined()
    expect(world.session.notice()).toBeUndefined()
  })
})
