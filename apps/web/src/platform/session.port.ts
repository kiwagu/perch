import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import { token } from '@workspace/di'

export interface SignOutOptions {
  /** Sign out even though this device holds changes the gateway has not received; they are lost. */
  readonly forgetUnsent?: boolean
}

/**
 * A word the session leaves for the sign-in page: `resend-after-sign-in` when the device was
 * signed out (its keys refused, or a write landing during its sign-out) while it held changes it
 * had not sent; they are kept on the device, and signing in again as the same identity sends them.
 */
export type SessionNotice = 'resend-after-sign-in'

/** The signed-in user of the application and the transitions between users. */
export interface SessionPort {
  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  /**
   * Signs this device out: `signed-out` once its changes reached the gateway (or were given up
   * with `forgetUnsent`) and its local data is gone; `needs-confirmation`, changing nothing,
   * when changes could not be sent and signing out would lose them.
   */
  signOut(options?: SignOutOptions): ResultAsync<'signed-out' | 'needs-confirmation', DataError>
  current(): AuthUser | undefined
  subscribe(listener: (user: AuthUser | undefined) => void): () => void
  /** Resolves once every write so far is durable and projected; reports a write that is not durable. */
  flush(): ResultAsync<void, DataError>
  /** The word the last session left for the sign-in page, until `clearNotice`. */
  notice(): SessionNotice | undefined
  clearNotice(): void
}

export const SESSION = token<SessionPort>('Session')
