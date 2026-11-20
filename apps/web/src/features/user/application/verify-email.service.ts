import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

import type { EmailVerified, SessionPort } from '../../../platform/session.port'

import type { SignInError } from './sign-in.service'

/** Exchanges a verification link's token, and has its mail sent again. */
export class VerifyEmailService {
  constructor(private readonly session: Pick<SessionPort, 'verifyEmail' | 'resendVerification'>) {}

  /**
   * The first verification signs this device in, and the session keeps the account's start, which
   * the device finishes once it has pulled what the account has. A link verified before changes
   * nothing.
   */
  verify(token: string): ResultAsync<EmailVerified, SignInError> {
    return this.session.verifyEmail(token)
  }

  /** Has the verification mail sent to `email` again. */
  resend(email: string): ResultAsync<void, SignInError> {
    return this.session.resendVerification(email)
  }
}

export const VERIFY_EMAIL_SERVICE = token<VerifyEmailService>('VerifyEmailService')
