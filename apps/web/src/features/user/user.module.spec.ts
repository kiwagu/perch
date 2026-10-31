import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SHAPE_RUNNER } from '@workspace/data'
import { Container } from '@workspace/di'
import { profileIdFactory, settingsIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../composition/__fixtures__/session'
import type { SessionService } from '../../composition/session'
import { COMMANDS } from '../../platform/commands.port'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE } from './application/profile.service'
import { settingsCommands, settingsShape } from './application/settings/settings.model.gen'
import { SETTINGS_SERVICE, SettingsService } from './application/settings/settings.service'
import { SIGN_IN_SERVICE } from './application/sign-in.service'
import { UserModule } from './user.module'

let opened: TestSession
let session: SessionService
let container: Container

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session

  const root = new Container()
    .singleton(SHAPE_RUNNER, () => opened.runner)
    .singleton(COMMANDS, () => opened.commands)
    .singleton(SESSION, () => session)
    // The composition root provides the settings to the frame and to every module.
    .singleton(
      SETTINGS_SERVICE,
      () =>
        new SettingsService(opened.runner, opened.commands, {
          shape: settingsShape,
          commands: settingsCommands,
        }),
    )

  container = root.child()

  for (const provider of UserModule.providers) {
    container.singleton(provider.provide, provider.useFactory)
  }
})

afterEach(async () => {
  await opened.close()
})

describe('UserModule', () => {
  it('provides sign-in, profile and settings services over the application ports', async () => {
    const email = 'ann@example.test'

    expect(
      (
        await container
          .get(SIGN_IN_SERVICE)
          .signUp({ email, password: 'secret-ann', name: 'Ann', locale: 'en' })
      ).isOk(),
    ).toBe(true)

    // The link of its mail signs this device in.
    const verified = (await session.verifyEmail(opened.auth.linkFor(email)))._unsafeUnwrap()
    const user = verified.kind === 'signed-in' ? verified.user : expect.unreachable('signed in')

    expect(
      (
        await container.get(PROFILE_SERVICE).createProfile({
          id: profileIdFactory.create(),
          identity: user.id,
          name: 'Ann',
          email: user.email,
        })
      ).isOk(),
    ).toBe(true)
    expect(
      (
        await container
          .get(SETTINGS_SERVICE)
          .createSettings({ id: settingsIdFactory.create(), identity: user.id, locale: 'en' })
      ).isOk(),
    ).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)

    expect(
      (await container.get(PROFILE_SERVICE).read({ identity: user.id }))._unsafeUnwrap(),
    ).toMatchObject([{ name: 'Ann' }])
    expect(
      (await container.get(SETTINGS_SERVICE).read({ identity: user.id }))._unsafeUnwrap(),
    ).toMatchObject([{ locale: 'en' }])
  })

  it('routes guests to sign-in and signed-in users to their profile and their settings', () => {
    expect(UserModule.routes).toEqual([
      { path: '/sign-in', page: 'SignInPage', guard: 'guest' },
      { path: '/me', page: 'ProfilePage', guard: 'authenticated' },
      { path: '/settings', page: 'SettingsPage', guard: 'authenticated' },
    ])
    expect(Object.keys(UserModule.declarations).sort()).toEqual([
      'ProfilePage',
      'SettingsPage',
      'SignInPage',
    ])
  })
})
