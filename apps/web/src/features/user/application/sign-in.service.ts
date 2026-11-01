import { errAsync, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { AuthUser, DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'

import type { SessionPort } from '../../../platform/session.port'

import { profileName } from './profile-name.policy'

/** What the form collects, and the language the app speaks as it is sent; signing in ignores the name and the language. */
export interface SignInForm {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly locale: Locale
}

export type SignInError = DataError | BusError

/** Signs into an account, or creates one and has its verification mail sent; nothing is signed in at sign-up. */
export class SignInService {
  constructor(
    private readonly session: Pick<SessionPort, 'signIn' | 'signUp' | 'resendVerification'>,
  ) {}

  signIn(form: SignInForm): ResultAsync<AuthUser, SignInError> {
    return this.session.signIn({ email: form.email, password: form.password })
  }

  /**
   * Creates the account with its name (checked first) and the language the app speaks now, and has
   * its verification mail sent. The account's settings and profile are created where its link is
   * first opened, from that name and language.
   */
  signUp(form: SignInForm): ResultAsync<void, SignInError> {
    const name = profileName(form.name)

    return name.isErr()
      ? errAsync(name.error)
      : this.session.signUp({
          email: form.email,
          password: form.password,
          name: name.value,
          locale: form.locale,
        })
  }

  /** Has the verification mail sent to `email` again. */
  resend(email: string): ResultAsync<void, SignInError> {
    return this.session.resendVerification(email)
  }
}

export const SIGN_IN_SERVICE = token<SignInService>('SignInService')
