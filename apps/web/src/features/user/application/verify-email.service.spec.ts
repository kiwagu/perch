import { errAsync, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory, settingsIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import type { EmailVerified, SessionPort } from '../../../platform/session.port'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import type { NewProfile } from './profile.service'
import { ProfileService } from './profile.service'
import { settingsCommands, settingsShape } from './settings/settings.model.gen'
import type { NewSettings } from './settings/settings.service'
import { SettingsService } from './settings/settings.service'
import { VerifyEmailService } from './verify-email.service'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

const signedIn: EmailVerified = { kind: 'signed-in', user: ann, name: 'Ann', locale: 'es' }

const verifiedBefore: EmailVerified = { kind: 'verified-before' }

/** The session's half of a verification: it answers `answer`, and resends whatever it is asked. */
function sessionAnswering(answer: () => ReturnType<SessionPort['verifyEmail']>) {
  return {
    verifyEmail: vi.fn((_token: string) => answer()),
    resendVerification: vi.fn((_email: string) => okAsync(undefined)),
  }
}

/** Where the account is made whole: every write lands in `written`, in order. */
function writes(refuseSettings = false) {
  const written: Array<{ readonly settings: NewSettings } | { readonly profile: NewProfile }> = []

  return {
    written,
    profiles: {
      createProfile: (profile: NewProfile) => {
        written.push({ profile })

        return okAsync(undefined)
      },
    },
    settings: {
      createSettings: (settings: NewSettings) => {
        if (refuseSettings) {
          return errAsync(dataError('data:WRITE_FAILED', 'not stored'))
        }

        written.push({ settings })

        return okAsync(undefined)
      },
    },
  }
}

describe('VerifyEmailService', () => {
  it('starts a first verification with the settings in the language it signed up in, then the profile with its name and email, and answers it', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const { written, profiles, settings } = writes()
    const service = new VerifyEmailService(session, profiles, settings)

    expect((await service.verify('the-token'))._unsafeUnwrap()).toEqual(signedIn)
    expect(session.verifyEmail).toHaveBeenCalledExactlyOnceWith('the-token')
    expect(written).toMatchObject([
      { settings: { identity: ann.id, locale: 'es' } },
      { profile: { identity: ann.id, name: 'Ann', email: ann.email } },
    ])

    const [first, second] = written

    // Each starts with an id of its own kind.
    expect(first && 'settings' in first && settingsIdFactory.is(first.settings.id)).toBe(true)
    expect(second && 'profile' in second && profileIdFactory.is(second.profile.id)).toBe(true)
  })

  it('creates nothing for a link verified before', async () => {
    const session = sessionAnswering(() => okAsync(verifiedBefore))
    const { written, profiles, settings } = writes()
    const service = new VerifyEmailService(session, profiles, settings)

    expect((await service.verify('the-token'))._unsafeUnwrap()).toEqual(verifiedBefore)
    expect(written).toEqual([])
  })

  it('creates nothing when the session refuses the link, another account signed in on this browser included', async () => {
    const session = sessionAnswering(() =>
      errAsync(dataError('data:OTHER_ACCOUNT', 'another account is signed in')),
    )
    const { written, profiles, settings } = writes()
    const service = new VerifyEmailService(session, profiles, settings)

    expect((await service.verify('the-token'))._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(written).toEqual([])
  })

  it('fails the verification with the error of the settings it could not create, and creates no profile', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const { written, profiles, settings } = writes(true)
    const service = new VerifyEmailService(session, profiles, settings)

    expect((await service.verify('the-token'))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(written).toEqual([])
  })

  it('asks the session once to send the mail again', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const { written, profiles, settings } = writes()
    const service = new VerifyEmailService(session, profiles, settings)

    expect((await service.resend('ann@example.test')).isOk()).toBe(true)
    expect(session.resendVerification).toHaveBeenCalledExactlyOnceWith('ann@example.test')
    expect(session.verifyEmail).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })
})

describe('VerifyEmailService on a session', () => {
  let opened: TestSession
  let profiles: ProfileService
  let settings: SettingsService
  let service: VerifyEmailService

  beforeEach(async () => {
    opened = await openTestSession()
    profiles = new ProfileService(opened.runner, opened.commands, {
      shape: profileShape,
      commands: profileCommands,
    })
    settings = new SettingsService(opened.runner, opened.commands, {
      shape: settingsShape,
      commands: settingsCommands,
    })
    service = new VerifyEmailService(opened.session, profiles, settings)
  })

  afterEach(async () => {
    await opened.close()
  })

  it('makes the account whole where its link is first opened, and only there and then', async () => {
    const input = {
      email: 'ann@example.test',
      password: 'pass-word-1',
      name: 'Ann',
      locale: 'es' as const,
    }

    expect((await opened.session.signUp(input)).isOk()).toBe(true)

    const link = opened.auth.linkFor(input.email)
    const first = (await service.verify(link))._unsafeUnwrap()
    const identity = first.kind === 'signed-in' ? first.user.id : expect.unreachable('signed in')

    expect(opened.session.current()?.id).toBe(identity)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity }))._unsafeUnwrap()).toMatchObject([{ locale: 'es' }])
    expect((await profiles.read({ identity }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: input.email },
    ])

    // Opened again: verified before, nothing more is created.
    expect((await service.verify(link))._unsafeUnwrap()).toEqual(verifiedBefore)
    expect((await opened.session.flush()).isOk()).toBe(true)
    expect((await settings.read({ identity }))._unsafeUnwrap()).toHaveLength(1)
    expect((await profiles.read({ identity }))._unsafeUnwrap()).toHaveLength(1)
  })
})
