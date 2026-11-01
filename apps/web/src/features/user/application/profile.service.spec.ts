import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { type ProfileId, profileIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { ProfileService } from './profile.service'

let opened: TestSession
let session: SessionService
let service: ProfileService
let me: AuthUser
let profileId: ProfileId

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session
  service = new ProfileService(opened.runner, opened.commands, {
    shape: profileShape,
    commands: profileCommands,
  })
  me = (
    await session.signUp({ email: 'ann@example.test', password: 'secret-ann', name: 'Ann' })
  )._unsafeUnwrap()
  profileId = profileIdFactory.create()

  expect(
    (
      await service.createProfile({ id: profileId, identity: me.id, name: 'Ann', email: me.email })
    ).isOk(),
  ).toBe(true)

  expect((await session.flush()).isOk()).toBe(true)
})

afterEach(async () => {
  await opened.close()
})

describe('ProfileService', () => {
  it('reads the profile tree of the signed-in user', async () => {
    const tree = (await service.read({ identity: me.id }))._unsafeUnwrap()

    const [row, ...others] = tree
    const { id, created_at: createdAt, ...stable } = row ?? expect.unreachable('a profile row')

    expect(others).toEqual([])
    expect(id).toBe(profileId)
    expect(createdAt).toBeInstanceOf(Date)
    expect(stable).toMatchSnapshot()
  })

  it('renames the profile and re-emits the tree', async () => {
    const seen: Array<string | undefined> = []
    const stop = service.watch({ identity: me.id }, (tree) => seen.push(tree[0]?.name))

    expect((await service.updateName({ id: profileId, name: '  Renamed ' })).isOk()).toBe(true)

    await vi.waitFor(() => expect(seen.at(-1)).toBe('Renamed'))

    stop()
  })

  it('refuses an empty name with the domain reason and keeps the old one', async () => {
    const result = await service.updateName({ id: profileId, name: '   ' })

    expect(result._unsafeUnwrapErr().code).toBe('profile:NAME_REQUIRED')

    expect((await session.flush()).isOk()).toBe(true)

    expect((await service.read({ identity: me.id }))._unsafeUnwrap()[0]?.name).toBe('Ann')
  })

  it('refuses a bio longer than 2000 characters with the domain reason and keeps the old one', async () => {
    expect((await service.updateBio({ id: profileId, bio: 'Hello' })).isOk()).toBe(true)

    const result = await service.updateBio({ id: profileId, bio: 'x'.repeat(2001) })

    expect(result._unsafeUnwrapErr().code).toBe('profile:BIO_TOO_LONG')
    expect((await session.flush()).isOk()).toBe(true)
    expect((await service.read({ identity: me.id }))._unsafeUnwrap()[0]?.bio).toBe('Hello')
  })

  it('keeps the biography', async () => {
    expect((await service.updateBio({ id: profileId, bio: 'Hello' })).isOk()).toBe(true)

    expect((await session.flush()).isOk()).toBe(true)

    expect((await service.read({ identity: me.id }))._unsafeUnwrap()[0]).toMatchObject({
      bio: 'Hello',
    })
  })
})
