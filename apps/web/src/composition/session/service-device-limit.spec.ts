import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { signedIn } from '../__fixtures__/signed-in'
import { type KeptDevice, memoryStorage, savedIdentity, savedSession } from '../storage'

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

  signedIn(storage, ann)

  const booted = await openTestWorld({ storage, online: true })

  worlds.push(booted)
  expect((await booted.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

  return booted
}

describe("a sign-in past the account's limit of devices, on another device", () => {
  it('signs the device out when its channel closes with 4003, and the sign-in page says why', async () => {
    const { session, stub, storage, destroyed } = await annSyncing()
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    stub.closeChannels(ann.identity.id, id, CLOSE.deviceLimit)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('device-limit-elsewhere')
    // The session ended on the gateway: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps a device signed in while the limit signs out another one', async () => {
    const { session, stub } = await annSyncing()

    stub.closeChannels(ann.identity.id, 'another-device', CLOSE.deviceLimit)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.notice()).toBeUndefined()
  })
})
