import { errAsync, okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import { openTestSession, type TestSession } from '../../../composition/__fixtures__/session'
import type { EmailVerified, SessionPort } from '../../../platform/session.port'
import { profileCommands, profileShape } from '../presentation/pages/profile/profile.model.gen'

import { type AccountStart, AccountStartService } from './account-start.service'
import { ProfileService } from './profile.service'
import { settingsCommands, settingsShape } from './settings/settings.model.gen'
import { SettingsService } from './settings/settings.service'
import type { SignInError } from './sign-in.service'
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

/** The one start a browser keeps, in memory. */
function keptHere() {
  let start: AccountStart | undefined

  return {
    keep: (next: AccountStart) => {
      start = next
    },
    kept: () => start,
    forget: () => {
      start = undefined
    },
  }
}

/** The start of the account a first verification hands over: it answers `failure`, or starts. */
function startsAnswering(failure?: SignInError) {
  return {
    start: vi.fn((_user: AuthUser, _from: { readonly name: string; readonly locale: string }) =>
      failure === undefined ? okAsync(undefined) : errAsync(failure),
    ),
  }
}

describe('VerifyEmailService', () => {
  it('starts the account a first verification signed in, from the name and the language it signed up with, and answers it', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const starts = startsAnswering()
    const service = new VerifyEmailService(session, starts)

    expect((await service.verify('the-token'))._unsafeUnwrap()).toEqual(signedIn)
    expect(session.verifyEmail).toHaveBeenCalledExactlyOnceWith('the-token')
    expect(starts.start).toHaveBeenCalledExactlyOnceWith(ann, { name: 'Ann', locale: 'es' })
  })

  it('starts nothing for a link verified before', async () => {
    const session = sessionAnswering(() => okAsync(verifiedBefore))
    const starts = startsAnswering()
    const service = new VerifyEmailService(session, starts)

    expect((await service.verify('the-token'))._unsafeUnwrap()).toEqual(verifiedBefore)
    expect(starts.start).not.toHaveBeenCalled()
  })

  it('starts nothing when the session refuses the link, another account signed in on this browser included', async () => {
    const session = sessionAnswering(() =>
      errAsync(dataError('data:OTHER_ACCOUNT', 'another account is signed in')),
    )
    const starts = startsAnswering()
    const service = new VerifyEmailService(session, starts)

    expect((await service.verify('the-token'))._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(starts.start).not.toHaveBeenCalled()
  })

  it('fails the verification with the error of a start that did not finish', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const starts = startsAnswering(dataError('data:WRITE_FAILED', 'not stored'))
    const service = new VerifyEmailService(session, starts)

    expect((await service.verify('the-token'))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
  })

  it('asks the session once to send the mail again', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const starts = startsAnswering()
    const service = new VerifyEmailService(session, starts)

    expect((await service.resend('ann@example.test')).isOk()).toBe(true)
    expect(session.resendVerification).toHaveBeenCalledExactlyOnceWith('ann@example.test')
    expect(session.verifyEmail).not.toHaveBeenCalled()
    expect(starts.start).not.toHaveBeenCalled()
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
    service = new VerifyEmailService(
      opened.session,
      new AccountStartService(profiles, settings, keptHere(), (run) => run()),
    )
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
