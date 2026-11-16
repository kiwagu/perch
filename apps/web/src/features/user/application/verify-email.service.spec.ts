import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { type AuthUser, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { EmailVerified, SessionPort } from '../../../platform/session.port'

import { VerifyEmailService } from './verify-email.service'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

const signedIn: EmailVerified = { kind: 'signed-in', user: ann }

const verifiedBefore: EmailVerified = { kind: 'verified-before' }

/** The session's half of a verification: it answers `answer`, and resends whatever it is asked. */
function sessionAnswering(answer: () => ReturnType<SessionPort['verifyEmail']>) {
  return {
    verifyEmail: vi.fn((_token: string) => answer()),
    resendVerification: vi.fn((_email: string) => okAsync(undefined)),
  }
}

describe('VerifyEmailService', () => {
  it.each([
    ['the first verification, which signed this device in', signedIn],
    ['a link verified before', verifiedBefore],
  ])('answers what the session made of %s', async (_, answer) => {
    const session = sessionAnswering(() => okAsync(answer))
    const service = new VerifyEmailService(session)

    expect((await service.verify('the-token'))._unsafeUnwrap()).toEqual(answer)
    expect(session.verifyEmail).toHaveBeenCalledExactlyOnceWith('the-token')
  })

  it('fails as the session refuses the link, another account signed in on this browser included', async () => {
    const session = sessionAnswering(() =>
      errAsync(dataError('data:OTHER_ACCOUNT', 'another account is signed in')),
    )
    const service = new VerifyEmailService(session)

    expect((await service.verify('the-token'))._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
  })

  it('asks the session once to send the mail again', async () => {
    const session = sessionAnswering(() => okAsync(signedIn))
    const service = new VerifyEmailService(session)

    expect((await service.resend('ann@example.test')).isOk()).toBe(true)
    expect(session.resendVerification).toHaveBeenCalledExactlyOnceWith('ann@example.test')
    expect(session.verifyEmail).not.toHaveBeenCalled()
  })
})
