import { okAsync, type ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'

import type { EmailVerified, SessionPort } from '../../../platform/session.port'

import type { AccountStartService } from './account-start.service'
import type { SignInError } from './sign-in.service'

/** Exchanges a verification link's token, and starts the account where it first signs in. */
export class VerifyEmailService {
  constructor(
    private readonly session: Pick<SessionPort, 'verifyEmail' | 'resendVerification'>,
    private readonly starts: Pick<AccountStartService, 'start'>,
  ) {}

  /**
   * The first verification signs this device in, and the account starts there from the name and
   * the language it signed up with (its settings and its profile, finished on this browser later
   * if they stop half-way). A link verified before changes nothing.
   */
  verify(token: string): ResultAsync<EmailVerified, SignInError> {
    return this.session
      .verifyEmail(token)
      .andThen((verified) =>
        verified.kind === 'verified-before'
          ? okAsync(verified)
          : this.starts
              .start(verified.user, { name: verified.name, locale: verified.locale })
              .map(() => verified),
      )
  }

  /** Has the verification mail sent to `email` again. */
  resend(email: string): ResultAsync<void, SignInError> {
    return this.session.resendVerification(email)
  }
}

export const VERIFY_EMAIL_SERVICE = token<VerifyEmailService>('VerifyEmailService')
