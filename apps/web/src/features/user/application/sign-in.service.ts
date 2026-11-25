import { err, errAsync, ok, type Result, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { CodeStep, DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'

import type { SessionPort, SignInResult } from '../../../platform/session.port'

import { profileName } from './profile-name.policy'
import { secondFactorCode } from './second-factor-code.policy'

/** What the form collects, and the language the app speaks as it is sent; signing in ignores the name and the language. */
export interface SignInForm {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly locale: Locale
}

/**
 * A sign-in refused at the account's limit of devices: nothing is signed in, and the form asks
 * whether to sign in all the same. A passkey sign-in names the account it asked about
 * (`consentFor`), which its confirmation must name.
 */
export interface DeviceLimitRefusal extends DataError {
  readonly code: 'data:DEVICE_LIMIT'
  readonly consentFor?: string
}

export type SignInError = DataError | BusError

/**
 * What a step of signing in did: signed the device in (`signed-in`), or asked for a code of the
 * account's second factor, signing nothing in (`code-required`, with the challenge and the email
 * typed, which the code step takes). A step that finds the account signed in on as many devices as
 * it may be at once is refused (`DeviceLimitRefusal`), as the session's `device-limit` answer.
 */
export type SignInOutcome = Exclude<SignInResult, { readonly kind: 'device-limit' }>

/** The session's answer to a step of signing in, its `device-limit` refused as `data:DEVICE_LIMIT`. */
function pastTheLimit(answer: SignInResult): Result<SignInOutcome, SignInError> {
  if (answer.kind !== 'device-limit') {
    return ok(answer)
  }

  const refusal: DeviceLimitRefusal = {
    code: 'data:DEVICE_LIMIT',
    message: 'the account is signed in on as many devices as it may be',
    ...(answer.consentFor === undefined ? {} : { consentFor: answer.consentFor }),
  }

  return err(refusal)
}

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
   * account at its limit signs nothing in and is refused (`data:DEVICE_LIMIT`). An account whose second
   * factor is on answers `code-required` once its password is right, which `confirmSignIn` takes
   * the code for.
   */
  signIn(form: SignInForm, signOutOldest: boolean): ResultAsync<SignInOutcome, SignInError> {
    return this.session
      .signIn({
        email: form.email,
        password: form.password,
        ...(signOutOldest ? { signOutOldest } : {}),
      })
      .andThen(pastTheLimit)
  }

  /**
   * The code step of a sign-in that answered `code-required`: `code` is one the account's
   * authenticator app shows now, or a backup code not used yet. A code shorter or longer than the
   * contract allows is no code: it fails as `sign-in:CODE_INVALID` before the gateway is asked,
   * so it counts toward nothing. Within those bounds the gateway judges it: a wrong code fails as
   * `data:INVALID_CODE`, a step that is over as `data:CODE_EXPIRED`. `signOutOldest` signs in past
   * the account's limit of devices, as for `signIn`.
   */
  confirmSignIn(
    step: CodeStep,
    code: string,
    signOutOldest: boolean,
  ): ResultAsync<SignInOutcome, SignInError> {
    return secondFactorCode(code)
      .asyncAndThen((valid) => this.session.confirmSignIn(step, valid, signOutOldest))
      .andThen(pastTheLimit)
  }

  /**
   * Signs in with a passkey the browser picks, asking no password and no code. A sign-in refused
   * at the limit of devices names the account it asked about (`consentFor`); its confirmation names
   * that account again as `signOutOldestFor`.
   */
  signInWithPasskey(signOutOldestFor?: string): ResultAsync<SignInOutcome, SignInError> {
    return this.session.signInWithPasskey(signOutOldestFor).andThen(pastTheLimit)
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
