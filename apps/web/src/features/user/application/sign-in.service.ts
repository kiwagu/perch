import { errAsync, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { CodeStep, DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'

import type { SessionPort, SignInResult } from '../../../platform/session.port'

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
 * What a step of signing in did, as the session answers it: signed the device in
 * (`signed-in`), asked for a code of the account's second factor, signing nothing in
 * (`code-required`, with the challenge and the email typed, which the code step takes), or found
 * the account signed in on as many devices as it may be at once and signed nothing in
 * (`device-limit`; a passkey sign-in names the account it asked about in `consentFor`), which the
 * form asks about before it signs in all the same.
 */
export type SignInOutcome = SignInResult

/** Signs into an account, or creates one and has its verification mail sent; nothing is signed in at sign-up. */
export class SignInService {
  constructor(
    private readonly session: Pick<
      SessionPort,
      'signIn' | 'confirmSignIn' | 'signInWithPasskey' | 'signUp' | 'resendVerification'
    >,
  ) {}

  /**
   * Signs into the account of the form. `signOutOldest` signs in past the account's limit of
   * devices, signing out its device seen least recently; without it, a sign-in that finds the
   * account at its limit signs nothing in and answers `device-limit`. An account whose second
   * factor is on answers `code-required` once its password is right, which `confirmSignIn` takes
   * the code for.
   */
  signIn(form: SignInForm, signOutOldest: boolean): ResultAsync<SignInOutcome, SignInError> {
    return this.session.signIn({
      email: form.email,
      password: form.password,
      ...(signOutOldest ? { signOutOldest } : {}),
    })
  }

  /**
   * The code step of a sign-in that answered `code-required`: `code` is one the account's
   * authenticator app shows now, or a backup code not used yet. A wrong code fails as
   * `data:INVALID_CODE`, a step that is over as `data:CODE_EXPIRED`. `signOutOldest` signs in past
   * the account's limit of devices, as for `signIn`.
   */
  confirmSignIn(
    step: CodeStep,
    code: string,
    signOutOldest: boolean,
  ): ResultAsync<SignInOutcome, SignInError> {
    return this.session.confirmSignIn(step, code, signOutOldest)
  }

  /**
   * Signs in with a passkey the browser picks, asking no password and no code. A sign-in past the
   * limit of devices names the account it asked about; its confirmation names that account again
   * as `signOutOldestFor`.
   */
  signInWithPasskey(signOutOldestFor?: string): ResultAsync<SignInOutcome, SignInError> {
    return this.session.signInWithPasskey(signOutOldestFor)
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
