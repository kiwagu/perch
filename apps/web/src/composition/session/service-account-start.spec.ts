import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import type { GatewayAuth } from '../gateway-auth'
import { savedIdentity } from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Secret-ann1', name: 'Ann', locale: 'es' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

/** A gateway whose sign-in of Ann answers that her account has not started. */
async function notStarted() {
  const auth = fakeGatewayAuth()

  expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

  const starting: GatewayAuth = {
    ...auth,
    signIn: (input, device) =>
      auth
        .signIn(input, device)
        .andThen((signed) => okAsync({ ...signed, start: { name: 'Ann', locale: 'es' as const } })),
  }

  return { auth, starting }
}

describe('the start a sign-in answers', () => {
  it('is kept before the device is saved, for the account the sign-in signed in', async () => {
    const { starting } = await notStarted()
    let savedWhenKept: unknown = 'not kept'
    const world = await openTestWorld({
      auth: starting,
      online: false,
      keepAccountStart: () => {
        savedWhenKept = savedIdentity(world.storage)
      },
    })

    worlds.push(world)

    const user = (await world.session.signIn(annSignUp))._unsafeUnwrap()

    expect(savedWhenKept).toBeUndefined()
    expect(savedIdentity(world.storage)?.id).toBe(user.id)
  })

  it('names the account and what it starts from', async () => {
    const { starting } = await notStarted()
    const world = await openTestWorld({ auth: starting, online: false })

    worlds.push(world)

    const user = (await world.session.signIn(annSignUp))._unsafeUnwrap()

    expect(world.startsKept).toEqual([[user, { name: 'Ann', locale: 'es' }]])
  })

  it('is not there when the account has started', async () => {
    const { auth } = await notStarted()
    const world = await openTestWorld({ auth, online: false })

    worlds.push(world)

    expect((await world.session.signIn(annSignUp)).isOk()).toBe(true)
    expect(world.startsKept).toEqual([])
  })
})
