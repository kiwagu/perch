import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

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

/**
 * What a sign-in did: signed the device in, or signed nothing in because the account is signed in
 * on as many devices as it may be at once (`device-limit`), which the form asks about before it
 * signs in all the same. An account whose second factor is on asks for a code, which the form has
 * no step for yet: that is a failure (`data:AUTH_FAILED`).
 */
export type SignInOutcome =
  | { readonly kind: 'signed-in'; readonly user: AuthUser }
  | { readonly kind: 'device-limit' }

/** Signs into an account, or creates one and has its verification mail sent; nothing is signed in at sign-up. */
export class SignInService {
  constructor(
    private readonly session: Pick<SessionPort, 'signIn' | 'signUp' | 'resendVerification'>,
  ) {}

  /**
   * Signs into the account of the form. `signOutOldest` signs in past the account's limit of
   * devices, signing out its device seen least recently; without it, a sign-in that finds the
   * account at its limit signs nothing in and answers `device-limit`.
   */
  signIn(form: SignInForm, signOutOldest: boolean): ResultAsync<SignInOutcome, SignInError> {
    return this.session
      .signIn({
        email: form.email,
        password: form.password,
        ...(signOutOldest ? { signOutOldest } : {}),
      })
      .andThen((result): ResultAsync<SignInOutcome, SignInError> => {
        switch (result.kind) {
          case 'signed-in':
            return okAsync({ kind: 'signed-in', user: result.user })
          case 'device-limit':
            return okAsync({ kind: 'device-limit' })
          case 'code-required':
            // The screen has no step for the code yet: it shows a failure, signing nothing in.
            return errAsync({
              code: 'data:AUTH_FAILED',
              message: 'the account asks for a code the sign-in cannot take',
            })
        }
      })
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
