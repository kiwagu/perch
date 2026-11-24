import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeGatewayAuth } from '../__fixtures__/gateway-auth'
import { openTestWorld, type TestWorld, type TestWorldOptions } from '../__fixtures__/session'
import { signedInElsewhere } from '../__fixtures__/signed-in'
import type { KeptDevice } from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
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
  const opened = await openTestWorld({ online: false, ...options })

  worlds.push(opened)

  return opened
}

describe("the session's sign-ins of this tab", () => {
  it('says the account it tells of is its own doing while its verification signs it in, and not after', async () => {
    const auth = fakeGatewayAuth()
    const tab = await world({ auth })
    const signUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
    const toldHere: boolean[] = []

    tab.session.subscribe(() => toldHere.push(tab.session.signingInHere()))
    expect((await tab.session.signUp(signUp)).isOk()).toBe(true)
    expect((await tab.session.verifyEmail(auth.linkFor(signUp.email))).isOk()).toBe(true)

    expect(toldHere).toEqual([true])
    expect(tab.session.signingInHere()).toBe(false)
  })

  it("says an account another tab signed in is not this tab's doing", async () => {
    const tab = await world()
    const toldHere: boolean[] = []

    expect((await tab.session.restore()).isOk()).toBe(true)
    tab.session.subscribe(() => toldHere.push(tab.session.signingInHere()))
    signedInElsewhere(tab.storage, ann)

    await vi.waitFor(() => expect(tab.session.current()?.id).toBe(ann.identity.id))
    expect(toldHere).toEqual([false])
  })
})
