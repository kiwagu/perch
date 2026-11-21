/**
 * The doors a browser is signed in through: a password and the code its second factor asks for, a
 * passkey, and an email's verification link. Each runs as a session transition and, while it
 * signs an account in, says so (`signingInHere`): the account the session then tells of is this
 * tab's own doing. Every call of the gateway that can sign a device in runs inside the browser's
 * sign-in lock, right after the check that no other account is saved; what waits for a person (the
 * browser's passkey window) runs before the lock, so it never holds the other tabs up.
 */

import { errAsync, type ResultAsync } from 'neverthrow'

import type { CodeStep, DataError, SignInInput } from '@workspace/data'

import type { EmailVerified, SignInResult } from '../../../platform/session.port'
import type { GatewayAuth, NamedDevice, StepAnswer } from '../../gateway-auth'
import type { PasskeyCeremony } from '../../passkey-ceremony'
import type { KeyValueStorage } from '../../storage'
import { anyAccountSaved, otherAccountSaved, otherAccountSignedIn } from '../one-account'
import type { SessionTransitions } from '../transitions'
import { verifyEmail } from '../verification'

import type { Asked, SessionSignIn } from './attempts'

export interface SignInDoorsOptions {
  readonly transitions: SessionTransitions
  readonly signingIn: SessionSignIn
  readonly auth: GatewayAuth
  readonly ceremony: PasskeyCeremony
  readonly storage: KeyValueStorage
}

/** A step's answer as an attempt takes it: the device to keep, or the outcome that signs nothing in. */
function asked(answer: StepAnswer): Asked<SignInResult> {
  if (answer.kind === 'signed-in') {
    return { device: answer.device, signedIn: (user) => ({ kind: 'signed-in', user }) }
  }

  return {
    stopped:
      answer.consentFor === undefined
        ? { kind: 'device-limit' }
        : { kind: 'device-limit', consentFor: answer.consentFor },
  }
}

export class SignInDoors {
  readonly #transitions: SessionTransitions
  readonly #signingIn: SessionSignIn
  readonly #auth: GatewayAuth
  readonly #ceremony: PasskeyCeremony
  readonly #storage: KeyValueStorage
  /** The sign-ins this tab started that are running now. */
  #signingInHere = 0

  constructor(options: SignInDoorsOptions) {
    this.#transitions = options.transitions
    this.#signingIn = options.signingIn
    this.#auth = options.auth
    this.#ceremony = options.ceremony
    this.#storage = options.storage
  }

  signIn(input: SignInInput): ResultAsync<SignInResult, DataError> {
    return this.#enter(
      () => otherAccountSaved(this.#storage, input.email),
      (device) =>
        this.#auth.signIn(input, device).map(
          (answer): Asked<SignInResult> =>
            answer.kind === 'code-required'
              ? {
                  stopped: {
                    kind: 'code-required',
                    challenge: answer.challenge,
                    email: input.email,
                  },
                }
              : asked(answer),
        ),
    )
  }

  confirmSignIn(
    step: CodeStep,
    code: string,
    signOutOldest: boolean,
  ): ResultAsync<SignInResult, DataError> {
    return this.#enter(
      () => otherAccountSaved(this.#storage, step.email),
      (device) => this.#auth.confirmSignIn({ ...step, code, signOutOldest }, device).map(asked),
    )
  }

  signInWithPasskey(signOutOldestFor?: string): ResultAsync<SignInResult, DataError> {
    // The gateway is not asked for options for a sign-in that cannot be kept.
    if (anyAccountSaved(this.#storage)) {
      return errAsync(otherAccountSignedIn())
    }

    return this.#auth
      .passkeyOptions(this.#signingIn.device())
      .andThen(({ options, challenge }) =>
        // The options took time: another tab may have saved an account meanwhile, and no window is
        // opened for a sign-in that cannot be kept.
        anyAccountSaved(this.#storage)
          ? errAsync(otherAccountSignedIn())
          : this.#ceremony.authenticate(options).map((response) => ({ response, challenge })),
      )
      .andThen((assertion) =>
        // Another tab may have saved an account while the window was open: checked again in the lock.
        this.#enter(
          () => anyAccountSaved(this.#storage),
          (device) =>
            this.#auth
              .signInWithPasskey(
                {
                  ...assertion,
                  ...(signOutOldestFor === undefined ? {} : { signOutOldestFor }),
                },
                device,
              )
              .map(asked),
        ),
      )
  }

  verifyEmail(token: string): ResultAsync<EmailVerified, DataError> {
    return this.#transitions.serially((generation) =>
      this.#here(() => verifyEmail(this.#signingIn, this.#auth, token, generation)),
    )
  }

  signingInHere(): boolean {
    return this.#signingInHere > 0
  }

  /** A sign-in this tab starts: one transition, in the sign-in lock, told as this tab's own. */
  #enter(
    otherAccount: () => boolean,
    ask: (device: NamedDevice) => ResultAsync<Asked<SignInResult>, DataError>,
  ): ResultAsync<SignInResult, DataError> {
    return this.#transitions.serially((generation) =>
      this.#here(() => this.#signingIn.enter<SignInResult>(otherAccount, ask, generation)),
    )
  }

  /** Runs a sign-in this tab started; `signingInHere` says so while it runs. */
  #here<T>(run: () => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    const done = () => {
      this.#signingInHere -= 1
    }

    this.#signingInHere += 1

    return run().andTee(done).orTee(done)
  }
}
