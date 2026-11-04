import { afterEach, describe, expect, it } from 'vitest'

import { fakeGatewayAuth } from '../__fixtures__/gateway-auth'
import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { PASSWORD_RESET_KEY } from '../storage'

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
