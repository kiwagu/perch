import { okAsync, type ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import { profileIdFactory, settingsIdFactory } from '@workspace/ids'

import type { EmailVerified, SessionPort } from '../../../platform/session.port'

import type { ProfileService } from './profile.service'
import type { SettingsService } from './settings/settings.service'
import type { SignInError } from './sign-in.service'

/** Exchanges a verification link's token, and makes the account whole where it first signs in. */
export class VerifyEmailService {
  constructor(
    private readonly session: Pick<SessionPort, 'verifyEmail' | 'resendVerification'>,
    private readonly profiles: Pick<ProfileService, 'createProfile'>,
    private readonly settings: Pick<SettingsService, 'createSettings'>,
  ) {}

  /**
   * The first verification signs this device in: the account's settings start in the language it
   * signed up in, then its profile with the name it signed up with, as a sign-up did before (the
   * settings first: a later commit of the region never arrives without the earlier ones). A link
   * verified before changes nothing.
   */
  verify(token: string): ResultAsync<EmailVerified, SignInError> {
    return this.session.verifyEmail(token).andThen((verified) =>
      verified.kind === 'verified-before'
        ? okAsync(verified)
        : this.settings
            .createSettings({
              id: settingsIdFactory.create(),
              identity: verified.user.id,
              locale: verified.locale,
            })
            .andThen(() =>
              this.profiles.createProfile({
                id: profileIdFactory.create(),
                identity: verified.user.id,
                name: verified.name,
                email: verified.user.email,
              }),
            )
            .map(() => verified),
    )
  }

  /** Has the verification mail sent to `email` again. */
  resend(email: string): ResultAsync<void, SignInError> {
    return this.session.resendVerification(email)
  }
}

export const VERIFY_EMAIL_SERVICE = token<VerifyEmailService>('VerifyEmailService')
