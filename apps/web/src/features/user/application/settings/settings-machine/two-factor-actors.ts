import { errAsync } from 'neverthrow'
import { fromPromise } from 'xstate'

import type { TwoFactorId } from '@workspace/ids'

import { settled } from '../../../../../platform/actor-outcome'
import type { TwoFactorError } from '../../two-factor.service'

import type { SettingsMachineDeps } from './events'
import type { TwoFactorOutput } from './two-factor-output'

/**
 * What a confirmation invokes with: the code typed and the enrolment of the key shown (none when
 * no key is waiting for a code, which the confirmation is told changed).
 */
export interface Confirmation {
  readonly code: string
  readonly enrolment: TwoFactorId | undefined
}

/** The actors that turn the second factor on, off, and renew its codes, by the names of the flow's invokes. */
export function twoFactorActors(
  deps: Pick<
    SettingsMachineDeps,
    'enableTwoFactor' | 'confirmTwoFactor' | 'disableTwoFactor' | 'renewCodes'
  >,
) {
  return {
    'platform.two-factor.enable': fromPromise(
      ({ input }: { readonly input: { readonly password: string } }) =>
        settled(deps.enableTwoFactor(input.password)).then(
          (start): TwoFactorOutput => ({ kind: 'start', start }),
        ),
    ),
    'platform.two-factor.confirm': fromPromise(({ input }: { readonly input: Confirmation }) =>
      settled(
        input.enrolment === undefined
          ? errAsync<void, TwoFactorError>({
              code: 'data:TWO_FACTOR_CHANGED',
              message: 'no key is waiting for a code',
            })
          : deps.confirmTwoFactor(input.code, input.enrolment),
      ),
    ),
    'platform.two-factor.disable': fromPromise(
      ({ input }: { readonly input: { readonly password: string } }) =>
        settled(deps.disableTwoFactor(input.password)),
    ),
    'platform.two-factor.renew-codes': fromPromise(
      ({ input }: { readonly input: { readonly password: string } }) =>
        settled(deps.renewCodes(input.password)).then(
          (backupCodes): TwoFactorOutput => ({ kind: 'codes', backupCodes }),
        ),
    ),
  }
}
