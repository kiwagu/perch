import { afterEach, describe, expect, it } from 'vitest'

import { fakeGatewayAuth } from '../__fixtures__/gateway-auth'
import {
  openTestWorld,
  signUpVerified,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { memoryStorage, saveNotice } from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }

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

describe("the sign-in page's word, the browser's and this tab's own", () => {
  it('keeps the word each waiting tab left, whichever of their sign-in pages opens first', async () => {
    const storage = memoryStorage()
    const first = await world({ storage })
    const second = await world({ storage })

    first.session.leaveNotice('password-reset-elsewhere')
    second.session.leaveNotice('password-reset-elsewhere')
    // A session that ended meanwhile left the browser its word on why.
    saveNotice(storage, 'password-changed-elsewhere')

    // The first tab's sign-in page opens, says its word and takes what it read.
    expect(first.session.notice()).toBe('password-reset-elsewhere')
    first.session.clearNotice()

    expect(second.session.notice()).toBe('password-reset-elsewhere')
    second.session.clearNotice()
    expect(second.session.notice()).toBeUndefined()
  })

  it("keeps this tab's word when a session writes the browser's later, and says the browser's word on the device's data over it", async () => {
    const tab = await world()

    tab.session.leaveNotice('password-reset-elsewhere')
    saveNotice(tab.storage, 'password-changed-elsewhere')

    expect(tab.session.notice()).toBe('password-reset-elsewhere')

    saveNotice(tab.storage, 'resend-after-sign-in')

    expect(tab.session.notice()).toBe('resend-after-sign-in')
  })

  it('ends every waiting word as an account signs in here, and a tab that hears it late keeps the words left since', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()
    const signing = await world({ storage, auth })
    const late = await world({ storage })

    late.session.leaveNotice('password-reset-elsewhere')
    saveNotice(storage, 'signed-out-elsewhere')

    // Ann opens the link of her sign-up's mail in the first tab: an account signs in here.
    expect((await signUpVerified(signing.session, auth, annSignUp)).isOk()).toBe(true)

    expect(signing.session.notice()).toBeUndefined()
    expect(late.session.notice()).toBeUndefined()

    // The second tab's frame hears of it only once that session ended and left its word.
    saveNotice(storage, 'password-changed-elsewhere')
    late.session.dropNotice()

    expect(late.session.notice()).toBe('password-changed-elsewhere')
  })
})
