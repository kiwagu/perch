import { err, ok, type Result, ResultAsync } from 'neverthrow'
import type { RecordId, SurrealSession } from 'surrealdb'

import { userIdFactory } from '@workspace/ids'

import type { AuthPort, AuthUser } from './auth.port'
import { type DataError, type DataErrorCode, dataError } from './errors'
import type { LocalDb } from './types'

export interface AuthOptions {
  /** The record access method declared in the schema. */
  readonly access: string
  readonly namespace: string
  readonly database: string
}

interface AccountRecord {
  readonly id: RecordId
  readonly email: string
  readonly name: string
}

function toUser(record: AccountRecord | undefined): Result<AuthUser | undefined, DataError> {
  if (!record) {
    return ok(undefined)
  }

  const key = String(record.id.id)

  return userIdFactory.is(key)
    ? ok({ id: key, email: record.email, name: record.name })
    : err(dataError('data:AUTH_FAILED', `account key ${key} is not a user id`))
}

/**
 * Auth over a session of its own: signing in turns that session into the user's,
 * while the connection's main session keeps the access it needs to run shapes
 * and to project replicated data.
 */
export function createAuth(local: LocalDb, options: AuthOptions): AuthPort {
  let session: Promise<SurrealSession> | undefined

  const open = (): Promise<SurrealSession> => {
    session ??= local.db.newSession().then(async (created) => {
      await created.use({ namespace: options.namespace, database: options.database })

      return created
    })

    return session
  }

  const attempt = <T>(
    code: DataErrorCode,
    message: string,
    run: (s: SurrealSession) => Promise<T>,
  ) => ResultAsync.fromPromise(open().then(run), (cause) => dataError(code, message, cause))

  const readCurrent = (s: SurrealSession): Promise<AccountRecord | undefined> =>
    s.accessToken ? (s.auth() as Promise<AccountRecord | undefined>) : Promise.resolve(undefined)

  const signedIn = (result: ResultAsync<AccountRecord | undefined, DataError>) =>
    result
      .andThen(toUser)
      .andThen((user) =>
        user ? ok(user) : err(dataError('data:AUTH_FAILED', 'no account after sign-in')),
      )

  let cachedToken: string | undefined

  const remember = (s: SurrealSession): SurrealSession => {
    cachedToken = s.accessToken

    return s
  }

  return {
    signUp: (input) =>
      signedIn(
        attempt('data:SIGN_UP_REJECTED', 'sign-up was rejected', async (s) => {
          await s.signup({ access: options.access, variables: { ...input } })

          return readCurrent(remember(s))
        }),
      ),

    signIn: (input) =>
      signedIn(
        attempt('data:INVALID_CREDENTIALS', 'wrong email or password', async (s) => {
          await s.signin({ access: options.access, variables: { ...input } })

          return readCurrent(remember(s))
        }),
      ),

    signOut: () =>
      attempt('data:AUTH_FAILED', 'sign-out failed', async (s) => {
        await s.invalidate()
        remember(s)
      }),

    current: () =>
      attempt('data:AUTH_FAILED', 'could not read the signed-in account', readCurrent).andThen(
        toUser,
      ),

    resume: (accessToken) =>
      attempt('data:AUTH_FAILED', 'the session could not be resumed', async (s) => {
        await s.authenticate(accessToken)

        return readCurrent(remember(s))
      }).andThen(toUser),

    token: () => cachedToken,
  }
}
