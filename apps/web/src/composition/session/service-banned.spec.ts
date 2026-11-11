import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { type KeptDevice, memoryStorage, saveDevice } from '../storage'

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

/** Ann's device, signed in and syncing: this tab leads, its channel is up. */
async function annSyncing(): Promise<TestWorld> {
  const storage = memoryStorage()

  saveDevice(storage, ann)

  const booted = await openTestWorld({ storage, online: true })

  worlds.push(booted)
  expect((await booted.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

  return booted
}

describe("an operator's ban of the account", () => {
  it('signs the device out when its channel closes with 4004, its data gone, and the sign-in page says why', async () => {
    const { session, stub, storage, destroyed } = await annSyncing()
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    stub.closeChannels(ann.identity.id, id, CLOSE.banned)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(storage.get('perch.session.token')).toBeUndefined()
    expect(session.notice()).toBe('account-banned')
    // The ban ended the session on the gateway: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps a device signed in while a ban closes the channel of another one', async () => {
    const { session, stub } = await annSyncing()

    stub.closeChannels(ann.identity.id, 'another-device', CLOSE.banned)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.notice()).toBeUndefined()
  })
})
