import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { openTestWorld, type TestWorld, type TestWorldOptions } from '../__fixtures__/session'
import {
  type KeptDevice,
  type MemoryStorage,
  memoryStorage,
  saveDevice,
  saveNotice,
} from '../storage'

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

/** Another tab of the browser signs `device` in: this tab hears each key it writes, in order. */
function signInElsewhere(storage: MemoryStorage, device: KeptDevice): void {
  const other = memoryStorage()

  saveDevice(other, device)

  for (const key of ['perch.session.token', 'perch.session.identity']) {
    storage.changeElsewhere(key, other.get(key))
  }
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

  it("drops this tab's word once an account signs in in this tab after it was left by a guest", async () => {
    const tab = await world()

    expect((await tab.session.restore()).isOk()).toBe(true)
    tab.session.leaveNotice('signed-out-elsewhere')
    signInElsewhere(tab.storage, ann)

    await vi.waitFor(() => expect(tab.session.current()?.id).toBe(ann.identity.id))
    expect(tab.session.notice()).toBeUndefined()
  })
})
