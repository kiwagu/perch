import { errAsync } from 'neverthrow'
import { fromPromise } from 'xstate'

import type { CodeStep } from '@workspace/data'

import { settled } from '../../../../platform/actor-outcome'
import type { SignInError, SignInOutcome, SignInService } from '../sign-in.service'

/**
 * What the code step invokes with: the step the password step asked for (none when no step is
 * under way, which the step is told is over), the code typed, and the limit of devices.
 */
export interface CodeAttempt {
  readonly step: CodeStep | undefined
  readonly code: string
  /** Whether the code step signs out the device seen least recently, once the dialog past the limit was confirmed. */
  readonly signOutOldest: boolean
}

/** What a passkey sign-in invokes with: the account its confirmation names, past the limit of devices. */
export interface PasskeyAttempt {
  readonly signOutOldestFor: string | undefined
}

/** The actors of the second steps, which sign in with a code and with a passkey. */
export function secondStepActors(
  service: Pick<SignInService, 'confirmSignIn' | 'signInWithPasskey'>,
) {
  return {
    'platform.confirm-sign-in': fromPromise(({ input }: { readonly input: CodeAttempt }) =>
      settled(
        input.step === undefined
          ? errAsync<SignInOutcome, SignInError>({
              code: 'data:CODE_EXPIRED',
              message: 'no code step is under way',
            })
          : service.confirmSignIn(input.step, input.code, input.signOutOldest),
      ),
    ),
    'platform.sign-in-passkey': fromPromise(({ input }: { readonly input: PasskeyAttempt }) =>
      settled(service.signInWithPasskey(input.signOutOldestFor)),
    ),
  }
}
