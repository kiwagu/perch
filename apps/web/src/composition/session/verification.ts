import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { EmailVerified } from '../../platform/session.port'
import type { GatewayAuth, VerifiedAccount } from '../gateway-auth'

import type { SessionSignIn } from './sign-in'

/**
 * Exchanges a verification link's token as a sign-in: in the browser's sign-in lock, with the
 * device named, its answer kept and the identity's space opened when the gateway signed the device
 * in, and refused when another account was saved meanwhile (one account per browser). A link
 * verified before signs nothing in, and nothing changes here.
 */
export function verifyEmail(
  signingIn: Pick<SessionSignIn, 'enter'>,
  auth: Pick<GatewayAuth, 'verifyEmail'>,
  token: string,
  generation: number,
): ResultAsync<EmailVerified, DataError> {
  let account: VerifiedAccount | undefined

  return signingIn
    .enter(
      undefined,
      (device) =>
        auth.verifyEmail(token, device).andThen((answer) => {
          if (answer.kind === 'verified-before') {
            return okAsync(undefined)
          }

          account = answer.account

          return okAsync(answer.device)
        }),
      generation,
    )
    .map(
      (user): EmailVerified =>
        user === undefined || account === undefined
          ? { kind: 'verified-before' }
          : { kind: 'signed-in', user, name: account.name, locale: account.locale },
    )
}
