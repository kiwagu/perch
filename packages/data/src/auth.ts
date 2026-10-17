import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import type { RecordId, SurrealSession } from 'surrealdb'

import { identityIdFactory } from '@workspace/ids'

import type { AuthPort, AuthTokens, AuthUser } from './auth.port'
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
}

function toUser(record: AccountRecord | undefined): Result<AuthUser | undefined, DataError> {
  if (!record) {
    return ok(undefined)
  }

  const key = String(record.id.id)

  return identityIdFactory.is(key)
    ? ok({ id: key, email: record.email })
    : err(dataError('data:AUTH_FAILED', `account key ${key} is not an identity id`))
}

/**
 * Auth over a session of its own: signing in turns that session into the user's,
 * while the connection's main session keeps the access it needs to run shapes
 * and to project replicated data.
 */
export function createAuth(local: LocalDb, options: AuthOptions): AuthPort {
  let session: Promise<SurrealSession> | undefined
  // The driver's session once it exists, so `close` reaches it even when selecting
  // the database on it failed.
  let created: SurrealSession | undefined
  let closed = false
  let current: AuthTokens | undefined
  const listeners = new Set<(tokens: AuthTokens | undefined) => void>()

  const open = (): Promise<SurrealSession> => {
    session ??= local.db.newSession().then(async (opened) => {
      created = opened
      // The driver announces every change of tokens on the session, including the
      // renewals it makes on its own before a token expires, which replace the
      // refresh key; this is the one place the current pair is learned from.
      opened.subscribe('auth', (tokens) => {
        current = tokens ? { access: tokens.access, refresh: tokens.refresh } : undefined

        for (const listener of listeners) {
          listener(current)
        }
      })
      await opened.use({ namespace: options.namespace, database: options.database })

      return opened
    })

    return session
  }

  const attempt = <T>(
    code: DataErrorCode,
    message: string,
    run: (s: SurrealSession) => Promise<T>,
  ): ResultAsync<T, DataError> =>
    closed
      ? errAsync(dataError('data:AUTH_FAILED', 'the auth session is closed'))
      : ResultAsync.fromPromise(open().then(run), (cause) => dataError(code, message, cause))

  const readCurrent = (s: SurrealSession): Promise<AccountRecord | undefined> =>
    s.accessToken ? (s.auth() as Promise<AccountRecord | undefined>) : Promise.resolve(undefined)

  const signedIn = (result: ResultAsync<AccountRecord | undefined, DataError>) =>
    result
      .andThen(toUser)
      .andThen((user) =>
        user ? ok(user) : err(dataError('data:AUTH_FAILED', 'no account after sign-in')),
      )

  return {
    signUp: (input) =>
      signedIn(
        attempt('data:SIGN_UP_REJECTED', 'sign-up was rejected', async (s) => {
          await s.signup({ access: options.access, variables: { ...input } })

          return readCurrent(s)
        }),
      ),

    signIn: (input) =>
      signedIn(
        attempt('data:INVALID_CREDENTIALS', 'wrong email or password', async (s) => {
          await s.signin({ access: options.access, variables: { ...input } })

          return readCurrent(s)
        }),
      ),

    signOut: () =>
      attempt('data:AUTH_FAILED', 'sign-out failed', async (s) => {
        await s.invalidate()
      }),

    current: () =>
      attempt('data:AUTH_FAILED', 'could not read the signed-in account', readCurrent).andThen(
        toUser,
      ),

    resume: (tokens) =>
      attempt('data:AUTH_FAILED', 'the session could not be resumed', async (s) => {
        // A refresh key is exchanged through a record sign-in that carries it: the
        // driver's own refresh call is refused by the embedded engines, which do not
        // declare the refresh-token feature although the database supports it.
        await (tokens.refresh
          ? s.signin({ access: options.access, variables: { refresh: tokens.refresh } })
          : s.authenticate(tokens.access))

        return readCurrent(s)
      }).andThen(toUser),

    tokens: () => current,

    onTokens: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },

    close: async () => {
      closed = true
      // Wait for an opening under way, so its session is closed too; a failed opening
      // already failed the call that started it.
      await session?.catch(() => undefined)

      const closing = created

      created = undefined
      await closing?.closeSession()
    },
  }
}
