import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SHAPE_RUNNER } from '@workspace/data'
import { Container } from '@workspace/di'
import { profileIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../composition/__fixtures__/session'
import type { SessionService } from '../../composition/session'
import { COMMANDS } from '../../platform/commands.port'
import { SESSION } from '../../platform/session.port'

import { PROFILE_SERVICE } from './application/profile.service'
import { settingsCommands, settingsShape } from './application/settings/settings.model.gen'
import { SETTINGS_SERVICE, SettingsService } from './application/settings/settings.service'
import { SIGN_IN_SERVICE } from './application/sign-in.service'
import { VERIFY_EMAIL_SERVICE } from './application/verify-email.service'
import { UserModule } from './user.module'

let opened: TestSession
let session: SessionService
let container: Container

beforeEach(async () => {
  opened = await openTestSession()
  session = opened.session

  const settings = new SettingsService(opened.runner, opened.commands, {
    shape: settingsShape,
    commands: settingsCommands,
  })
  const root = new Container()
    .singleton(SHAPE_RUNNER, () => opened.runner)
    .singleton(COMMANDS, () => opened.commands)
    .singleton(SESSION, () => session)
    // The composition root provides the settings to the frame and to every module.
    .singleton(SETTINGS_SERVICE, () => settings)

  container = root.child()

  for (const provider of UserModule.providers) {
    container.singleton(provider.provide, provider.useFactory)
  }
})

afterEach(async () => {
  await opened.close()
})

describe('UserModule', () => {
  it('provides sign-in, verification and profile services over the application ports', async () => {
    const email = 'ann@example.test'

    expect(
      (
        await container
          .get(SIGN_IN_SERVICE)
          .signUp({ email, password: 'Secret-ann1', name: 'Ann', locale: 'es' })
      ).isOk(),
    ).toBe(true)

    // The link of its mail signs this device in; the account starts once the device has pulled.
    const verified = (
      await container.get(VERIFY_EMAIL_SERVICE).verify(opened.auth.linkFor(email))
    )._unsafeUnwrap()
    const user = verified.kind === 'signed-in' ? verified.user : expect.unreachable('signed in')

    expect(session.current()?.id).toBe(user.id)

    // The profile service writes and reads the account's profile through the ports.
    const profiles = container.get(PROFILE_SERVICE)

    expect(
      (
        await profiles.createProfile({
          id: profileIdFactory.create(),
          identity: user.id,
          name: 'Ann',
          email,
        })
      ).isOk(),
    ).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email },
    ])
  })

  it('routes guests to sign-in, the verification of their email and the request of a reset mail, anyone to the links that set a password, confirm an email or delete an account, and signed-in users to their profile and their settings', () => {
    expect(
      UserModule.routes.map((route) => ({
        path: route.path,
        page: route.page,
        guard: route.guard,
        roles: route.roles,
        search: route.search === undefined ? undefined : Object.keys(route.search.shape),
      })),
    ).toEqual([
      { path: '/sign-in', page: 'SignInPage', guard: 'guest', roles: ['guest'], search: ['email'] },
      {
        path: '/verify-email',
        page: 'VerifyEmailPage',
        guard: 'guest',
        roles: ['guest'],
        search: ['token'],
      },
      {
        path: '/forgot-password',
        page: 'ForgotPasswordPage',
        guard: 'guest',
        roles: ['guest'],
        search: ['email'],
      },
      {
        path: '/reset-password',
        page: 'ResetPasswordPage',
        guard: undefined,
        roles: ['guest', 'identity'],
        search: ['token'],
      },
      {
        path: '/confirm-email',
        page: 'ConfirmEmailPage',
        guard: undefined,
        roles: ['guest', 'identity'],
        search: ['token'],
      },
      {
        path: '/delete-account',
        page: 'DeleteAccountPage',
        guard: undefined,
        roles: ['guest', 'identity'],
        search: ['token'],
      },
      {
        path: '/me',
        page: 'ProfilePage',
        guard: 'authenticated',
        roles: ['identity'],
        search: undefined,
      },
      {
        path: '/settings',
        page: 'SettingsPage',
        guard: 'authenticated',
        roles: ['identity'],
        search: undefined,
      },
    ])
    expect(Object.keys(UserModule.declarations).sort()).toEqual([
      'ConfirmEmailPage',
      'DeleteAccountPage',
      'ForgotPasswordPage',
      'ProfilePage',
      'ResetPasswordPage',
      'SettingsPage',
      'SignInPage',
      'VerifyEmailPage',
    ])
  })
})
