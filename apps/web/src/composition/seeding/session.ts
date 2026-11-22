/**
 * What a seed client asks of the session: the password sign-in alone, unwrapped to the user it
 * signed in. A seed account has no second factor and no passkey, so a sign-in that asks for a code
 * is a seeding error, and one past the limit of devices keeps the error it always was.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type SignInInput } from '@workspace/data'

import type { SessionPort } from '../../platform/session.port'

/** The session as the seed's steps use it. */
export interface SeedSession
  extends Pick<
    SessionPort,
    | 'signUp'
    | 'verifyEmail'
    | 'resendVerification'
    | 'memberships'
    | 'selectTenant'
    | 'currentTenant'
  > {
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
}

export function seedSession(session: SessionPort): SeedSession {
  return {
    signUp: (input) => session.signUp(input),
    verifyEmail: (token) => session.verifyEmail(token),
    resendVerification: (email) => session.resendVerification(email),
    memberships: () => session.memberships(),
    selectTenant: (key) => session.selectTenant(key),
    currentTenant: () => session.currentTenant(),
    signIn: (input) =>
      session.signIn(input).andThen((outcome) => {
        switch (outcome.kind) {
          case 'signed-in':
            return okAsync(outcome.user)
          case 'device-limit':
            return errAsync(
              dataError(
                'data:DEVICE_LIMIT',
                'the account is signed in on as many devices as it may be',
              ),
            )
          case 'code-required':
            return errAsync(
              dataError('data:AUTH_FAILED', 'the account asks for a code the seed has none of'),
            )
        }
      }),
  }
}
