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

describe('a change of the password elsewhere', () => {
  it('signs the device out when its channel closes with 4002, and the sign-in page says why', async () => {
    const { session, stub, storage, destroyed } = await annSyncing()
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    stub.closeChannels(ann.identity.id, id, CLOSE.passwordChanged)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('password-changed-elsewhere')
    // The session ended with the password: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps a device whose password changed on another one signed in until its own channel closes', async () => {
    const { session, stub } = await annSyncing()

    stub.closeChannels(ann.identity.id, 'another-device', CLOSE.passwordChanged)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.notice()).toBeUndefined()
  })
})
