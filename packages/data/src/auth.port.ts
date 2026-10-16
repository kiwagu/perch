import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import type { UserId } from '@workspace/ids'

import type { DataError } from './errors'

export interface AuthUser {
  readonly id: UserId
  readonly email: string
  readonly name: string
}

export interface SignUpInput {
  readonly email: string
  readonly password: string
  readonly name: string
}

export interface SignInInput {
  readonly email: string
  readonly password: string
}

/** Accounts and the signed-in session. Sign-in calls are not SurrealQL statements, so no `.surql` declares them. */
export interface AuthPort {
  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  signOut(): ResultAsync<void, DataError>
  current(): ResultAsync<AuthUser | undefined, DataError>
  /** Continues a session from a token kept by the caller, e.g. after a page reload. */
  resume(accessToken: string): ResultAsync<AuthUser | undefined, DataError>
  /** The access token of the signed-in session, if any. */
  token(): string | undefined
}

export const AUTH = token<AuthPort>('Auth')
