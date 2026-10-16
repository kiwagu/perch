import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuthUser, type LocalDb, ShapeRunner } from '@workspace/data'
import { type ProfileId, profileIdFactory } from '@workspace/ids'

import { openTestSession } from '../../../composition/__fixtures__/session'
import type { SessionService } from '../../../composition/session'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { localeChange, ProfileService } from './profile.service'

let local: LocalDb
let session: SessionService
let service: ProfileService
let me: AuthUser
let profileId: ProfileId

beforeEach(async () => {
  const opened = await openTestSession()

  local = opened.local
  session = opened.session
  service = new ProfileService(new ShapeRunner(local), opened.commands, {
    shape: profileShape,
    commands: profileCommands,
  })
  me = (
    await session.signUp({ email: 'ann@example.test', password: 'secret-ann', name: 'Ann' })
  )._unsafeUnwrap()
  profileId = profileIdFactory.create()

  expect(
    (
      await service.createProfile({ id: profileId, user: me.id, name: 'Ann', email: me.email })
    ).isOk(),
  ).toBe(true)

  await session.flush()
})

afterEach(async () => {
  await local.close()
})

describe('ProfileService', () => {
  it('reads the profile tree of the signed-in user', async () => {
    const tree = (await service.read({ user: me.id }))._unsafeUnwrap()

    const [row, ...others] = tree
    const { id, created_at: createdAt, ...stable } = row ?? expect.unreachable('a profile row')

    expect(others).toEqual([])
    expect(id).toBe(profileId)
    expect(createdAt).toBeInstanceOf(Date)
    expect(stable).toMatchSnapshot()
  })

  it('renames the profile and re-emits the tree', async () => {
    const seen: Array<string | undefined> = []
    const stop = service.watch({ user: me.id }, (tree) => seen.push(tree[0]?.name))

    expect((await service.updateName({ id: profileId, name: '  Renamed ' })).isOk()).toBe(true)

    await vi.waitFor(() => expect(seen.at(-1)).toBe('Renamed'))

    stop()
  })

  it('refuses an empty name with the domain reason and keeps the old one', async () => {
    const result = await service.updateName({ id: profileId, name: '   ' })

    expect(result._unsafeUnwrapErr().code).toBe('profile:NAME_REQUIRED')

    await session.flush()

    expect((await service.read({ user: me.id }))._unsafeUnwrap()[0]?.name).toBe('Ann')
  })

  it('keeps the biography and the chosen language', async () => {
    expect((await service.updateBio({ id: profileId, bio: 'Hello' })).isOk()).toBe(true)
    expect((await service.updateLocale({ id: profileId, locale: 'es' })).isOk()).toBe(true)

    await session.flush()

    expect((await service.read({ user: me.id }))._unsafeUnwrap()[0]).toMatchObject({
      bio: 'Hello',
      locale: 'es',
    })
  })
})

describe('localeChange', () => {
  it('applies the stored language when the profile first arrives', () => {
    expect(localeChange({ stored: 'es', current: 'en', first: true })).toEqual({ apply: 'es' })
    expect(localeChange({ stored: 'en', current: 'en', first: true })).toBeUndefined()
  })

  it('stores the current language when the profile has none it can use', () => {
    expect(localeChange({ stored: undefined, current: 'en', first: true })).toEqual({ save: 'en' })
    expect(localeChange({ stored: 'fr', current: 'es', first: true })).toEqual({ save: 'es' })
  })

  it('stores a language the user chose later', () => {
    expect(localeChange({ stored: 'es', current: 'en', first: false })).toEqual({ save: 'en' })
    expect(localeChange({ stored: 'en', current: 'en', first: false })).toBeUndefined()
  })
})
