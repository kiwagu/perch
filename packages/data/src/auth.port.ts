import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'

import type { DataError } from './errors'

/** The signed-in identity: the account's id and the email it signs in with. */
export interface AuthUser {
  readonly id: IdentityId
  readonly email: string
}

/** The keys of a signed-in session: a short-lived access token and the refresh key that renews it. */
export interface AuthTokens {
  readonly access: string
  readonly refresh?: string | undefined
}

export interface SignUpInput {
  readonly email: string
  readonly password: string
}

export interface SignInInput {
  readonly email: string
  readonly password: string
}

/**
 * Accounts and the signed-in session. Sign-in calls are not SurrealQL statements, so no `.surql`
 * declares them. Only a refusal by the database fails with an auth code
 * (`data:INVALID_CREDENTIALS`, `data:SIGN_UP_REJECTED`, `data:AUTH_FAILED`); a call it could not
 * judge (its session could not be opened, the database could not be reached, or the auth object
 * is closed) fails with `data:QUERY_FAILED`, and the same keys may work once it answers again.
 */
export interface AuthPort {
  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  signOut(): ResultAsync<void, DataError>
  current(): ResultAsync<AuthUser | undefined, DataError>
  /**
   * Continues a session from tokens kept by the caller, e.g. after a page reload. A
   * refresh key is exchanged for a new pair, and the key it replaces stops working.
   */
  resume(tokens: AuthTokens): ResultAsync<AuthUser | undefined, DataError>
  /** The tokens of the signed-in session, if any. */
  tokens(): AuthTokens | undefined
  /** Hears every change of tokens: sign-in, renewal (a new refresh key) and sign-out. */
  onTokens(listener: (tokens: AuthTokens | undefined) => void): () => void
  /**
   * Closes the auth session; the auth object is unusable afterwards. The tokens it handed
   * out stay valid: closing is not signing out.
   */
  close(): Promise<void>
}

export const AUTH = token<AuthPort>('Auth')
