import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import { token } from '@workspace/di'

/** The signed-in user of the application and the transitions between users. */
export interface SessionPort {
  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  signOut(): ResultAsync<void, DataError>
  current(): AuthUser | undefined
  subscribe(listener: (user: AuthUser | undefined) => void): () => void
  /** Resolves once every write so far is durable and projected into the database. */
  flush(): Promise<void>
}

export const SESSION = token<SessionPort>('Session')
