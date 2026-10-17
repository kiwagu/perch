import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'

import {
  type AuthPort,
  type AuthTokens,
  type AuthUser,
  type DataError,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import { z } from '@workspace/zod'

/** The keys a device keeps: the short-lived access token and the refresh key that renews it. */
export interface DeviceTokens {
  readonly access: string
  readonly refresh: string
}

export interface SignedIn {
  readonly identity: AuthUser
  readonly tokens: DeviceTokens
}

/**
 * A device whose keys were accepted: its access token as it came, or a pair renewed with
 * its refresh key. A renewed pair replaces the one the device holds, whose refresh key is
 * spent; a device that came without a refresh key has none.
 */
export type AuthenticatedDevice =
  | { readonly identity: AuthUser; readonly tokens: AuthTokens; readonly renewed: false }
  | { readonly identity: AuthUser; readonly tokens: DeviceTokens; readonly renewed: true }

export interface IdentitySessionsOptions {
  /** Opens an auth session of its own on the central database, through its identity access method. */
  readonly openAuth: () => AuthPort
  /** The database's RPC endpoint over HTTP, where `revoke` is sent. */
  readonly rpcUrl: string
  readonly fetch: typeof fetch
  /**
   * Hears that an auth session failed to close after its call. The call keeps its result:
   * the identity it signed up exists, and the refresh key it renewed is spent.
   */
  readonly onCloseFailure: (error: DataError) => void
}

/** An answer of the database's RPC; a revoke needs only to know whether it failed. */
const rpcAnswer = z.object({ error: z.object({ message: z.string() }).optional() })

function refused(message: string, cause?: unknown): DataError {
  return dataError('data:AUTH_FAILED', message, cause)
}

function identityOf(user: AuthUser | undefined): Result<AuthUser, DataError> {
  return user ? ok(user) : err(refused('no identity is signed in with these keys'))
}

/** The pair a sign-in left: without its refresh key a device could not stay signed in. */
function pairOf(tokens: AuthTokens | undefined): Result<DeviceTokens, DataError> {
  return tokens?.refresh
    ? ok({ access: tokens.access, refresh: tokens.refresh })
    : err(refused('the database answered the sign-in without a refresh key'))
}

function signedIn(auth: AuthPort, identity: AuthUser): Result<SignedIn, DataError> {
  return pairOf(auth.tokens()).map((tokens) => ({ identity, tokens }))
}

function renew(
  auth: AuthPort,
  tokens: { readonly access: string; readonly refresh: string },
): ResultAsync<AuthenticatedDevice, DataError> {
  return auth
    .resume(tokens)
    .andThen(identityOf)
    .andThen((identity) =>
      pairOf(auth.tokens()).map(
        (pair): AuthenticatedDevice => ({ identity, tokens: pair, renewed: true }),
      ),
    )
}

function readAnswer(response: Response): ResultAsync<unknown, DataError> {
  if (!response.ok) {
    return errAsync(refused(`the database answered the revoke with status ${response.status}`))
  }

  return ResultAsync.fromPromise(response.json() as Promise<unknown>, (cause) =>
    refused('the answer to the revoke is not JSON', cause),
  )
}

function revoked(answer: unknown): Result<void, DataError> {
  const parsed = rpcAnswer.safeParse(answer)

  if (!parsed.success) {
    return err(refused('the answer to the revoke has an unknown shape'))
  }

  // The database's message is left out: it may name the grant.
  return parsed.data.error
    ? err(refused('the database refused to revoke the grant'))
    : ok(undefined)
}

/**
 * Identities as the gateway serves them to devices. Every call runs on a database session
 * of its own that is closed when the call ends, so no call sees another's identity and the
 * connection keeps no session per device. Nothing here logs, and no error carries a key.
 */
export class IdentitySessions {
  readonly #openAuth: () => AuthPort
  readonly #onCloseFailure: (error: DataError) => void
  readonly #post: (url: string, init: RequestInit) => ResultAsync<Response, DataError>
  readonly #rpcUrl: string

  constructor(options: IdentitySessionsOptions) {
    this.#openAuth = options.openAuth
    this.#onCloseFailure = options.onCloseFailure
    this.#rpcUrl = options.rpcUrl
    this.#post = ResultAsync.fromThrowable(options.fetch, (cause) =>
      refused('the database could not be reached to revoke the grant', cause),
    )
  }

  signUp(input: SignUpInput): ResultAsync<SignedIn, DataError> {
    return this.#withAuth((auth) =>
      auth.signUp(input).andThen((identity) => signedIn(auth, identity)),
    )
  }

  signIn(input: SignInInput): ResultAsync<SignedIn, DataError> {
    return this.#withAuth((auth) =>
      auth.signIn(input).andThen((identity) => signedIn(auth, identity)),
    )
  }

  /** Accepts the access token, or renews the pair with the refresh key when the token no longer works. */
  authenticate(tokens: {
    readonly access: string
    readonly refresh?: string
  }): ResultAsync<AuthenticatedDevice, DataError> {
    const { access, refresh } = tokens

    return this.#withAuth((auth) =>
      auth
        .resume({ access })
        .andThen(identityOf)
        .map(
          (identity): AuthenticatedDevice => ({
            identity,
            tokens: { access, refresh },
            renewed: false,
          }),
        )
        .orElse((error) =>
          refresh === undefined ? errAsync(error) : renew(auth, { access, refresh }),
        ),
    )
  }

  /** Revokes the device's refresh grant through the database's RPC `revoke`. */
  revoke(tokens: DeviceTokens): ResultAsync<void, DataError> {
    const call = {
      id: 1,
      method: 'revoke',
      params: [{ access: tokens.access, refresh: tokens.refresh }],
    }

    return this.#post(this.#rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(call),
    })
      .andThen(readAnswer)
      .andThen(revoked)
  }

  /**
   * Runs `run` on a fresh auth session and closes the session however `run` ends. A failure
   * to close is reported, not returned: what `run` did in the database stands, so throwing
   * its result away would lose a new identity's pair or a renewed one.
   */
  #withAuth<T>(run: (auth: AuthPort) => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    const auth = this.#openAuth()
    const settled = async (): Promise<Result<T, DataError>> => {
      try {
        return await run(auth)
      } finally {
        await auth.close().catch((cause: unknown) => {
          this.#onCloseFailure(refused('the auth session could not be closed', cause))
        })
      }
    }

    return ResultAsync.fromPromise(settled(), (cause) =>
      refused('the identity session failed', cause),
    ).andThen((result) => result)
  }
}
