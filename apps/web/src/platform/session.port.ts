import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import { token } from '@workspace/di'

export interface SignOutOptions {
  /** Sign out even though this device holds changes the gateway has not received; they are lost. */
  readonly forgetUnsent?: boolean
}

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
}

export const SESSION = token<SessionPort>('Session')
