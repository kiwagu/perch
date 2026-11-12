import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { EmailVerified } from '../../platform/session.port'
import type { GatewayAuth } from '../gateway-auth'

import type { SessionSignIn } from './sign-in'

/**
 * Exchanges a verification link's token as a sign-in: in the browser's sign-in lock, with the
 * device named, its answer kept and the identity's space opened when the gateway signed the device
 * in, and refused when another account was saved meanwhile (one account per browser). The account
 * the first verification signed in has not started, so its start is kept as a sign-in that learnt
 * of one keeps it, to finish after this device's first pull: the gateway marked the email verified
 * before it signed this device in, so another device may have signed in and started it meanwhile.
 * A link verified before signs nothing in, and nothing changes here.
 */
export function verifyEmail(
  signingIn: Pick<SessionSignIn, 'enter'>,
  auth: Pick<GatewayAuth, 'verifyEmail'>,
  token: string,
  generation: number,
): ResultAsync<EmailVerified, DataError> {
  return signingIn
    .enter(
      undefined,
      (device) =>
        auth.verifyEmail(token, device).map((answer) =>
          answer.kind === 'verified-before'
            ? undefined
            : // The account starts as one a sign-in learnt of: once this device pulled what it has.
              { ...answer.device, start: answer.account },
        ),
      generation,
    )
    .map(
      (user): EmailVerified =>
        user === undefined ? { kind: 'verified-before' } : { kind: 'signed-in', user },
    )
}
