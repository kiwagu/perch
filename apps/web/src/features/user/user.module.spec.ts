import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SHAPE_RUNNER } from '@workspace/data'
import { Container } from '@workspace/di'

import { openTestSession, type TestSession } from '../../composition/__fixtures__/session'
import type { SessionService } from '../../composition/session'
import { keptAccountStart, memoryStorage } from '../../composition/storage'
import { COMMANDS } from '../../platform/commands.port'
import { SESSION } from '../../platform/session.port'

import { ACCOUNT_START_SERVICE, AccountStartService } from './application/account-start.service'
import { PROFILE_SERVICE, ProfileService } from './application/profile.service'
import { settingsCommands, settingsShape } from './application/settings/settings.model.gen'
import { SETTINGS_SERVICE, SettingsService } from './application/settings/settings.service'
import { SIGN_IN_SERVICE } from './application/sign-in.service'
import { VERIFY_EMAIL_SERVICE } from './application/verify-email.service'
import { profileCommands, profileShape } from './presentation/pages/profile/profile.model.gen'
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
    // The composition root provides the settings to the frame and to every module, and the start
    // of a new account, which it finishes where the account's space opens again.
    .singleton(SETTINGS_SERVICE, () => settings)
    .singleton(
      ACCOUNT_START_SERVICE,
      () =>
        new AccountStartService(
          new ProfileService(opened.runner, opened.commands, {
            shape: profileShape,
            commands: profileCommands,
          }),
          settings,
          keptAccountStart(memoryStorage()),
          (run) => run(() => opened.session.flush()),
          () => 'system',
        ),
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
  it('provides sign-in, verification, profile and settings services over the application ports', async () => {
    const email = 'ann@example.test'

    expect(
      (
        await container
          .get(SIGN_IN_SERVICE)
          .signUp({ email, password: 'Secret-ann1', name: 'Ann', locale: 'es' })
      ).isOk(),
    ).toBe(true)

    // The link of its mail signs this device in, and makes the account whole there.
    const verified = (
      await container.get(VERIFY_EMAIL_SERVICE).verify(opened.auth.linkFor(email))
    )._unsafeUnwrap()
    const user = verified.kind === 'signed-in' ? verified.user : expect.unreachable('signed in')

    expect((await session.flush()).isOk()).toBe(true)
    expect(
      (await container.get(PROFILE_SERVICE).read({ identity: user.id }))._unsafeUnwrap(),
    ).toMatchObject([{ name: 'Ann', email }])
    expect(
      (await container.get(SETTINGS_SERVICE).read({ identity: user.id }))._unsafeUnwrap(),
    ).toMatchObject([{ locale: 'es' }])
  })

  it('routes guests to sign-in, the verification of their email and the request of a reset mail, anyone to the links that set a password, confirm an email or delete an account, and signed-in users to their profile and their settings', () => {
    expect(
      UserModule.routes.map((route) => ({
        path: route.path,
        page: route.page,
        guard: route.guard,
        search: route.search === undefined ? undefined : Object.keys(route.search.shape),
      })),
    ).toEqual([
      { path: '/sign-in', page: 'SignInPage', guard: 'guest', search: ['email'] },
      { path: '/verify-email', page: 'VerifyEmailPage', guard: 'guest', search: ['token'] },
      {
        path: '/forgot-password',
        page: 'ForgotPasswordPage',
        guard: 'guest',
        search: ['email'],
      },
      {
        path: '/reset-password',
        page: 'ResetPasswordPage',
        guard: undefined,
        search: ['token'],
      },
      {
        path: '/confirm-email',
        page: 'ConfirmEmailPage',
        guard: undefined,
        search: ['token'],
      },
      {
        path: '/delete-account',
        page: 'DeleteAccountPage',
        guard: undefined,
        search: ['token'],
      },
      { path: '/me', page: 'ProfilePage', guard: 'authenticated', search: undefined },
      { path: '/settings', page: 'SettingsPage', guard: 'authenticated', search: undefined },
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
