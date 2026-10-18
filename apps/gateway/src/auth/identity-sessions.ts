import { createHash } from 'node:crypto'

import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import {
  type AuthPort,
  type AuthTokens,
  type AuthUser,
  type DataError,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { DeviceSessions } from './device-sessions'

/** The keys a device keeps: the short-lived access token and the refresh key that renews it. */
export interface DeviceTokens {
  readonly access: string
  readonly refresh: string
}

export interface SignedIn {
  readonly identity: AuthUser
  readonly tokens: DeviceTokens
}

/** The device an identity signs up or in on: the id it names itself with, and its label. */
export interface SignInDevice {
  readonly id: string
  readonly label: string
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
  /** Where each device of an identity is recorded with the refresh grant its pair holds. */
  readonly devices: Pick<DeviceSessions, 'touch'>
  /**
   * Hears that a renewed pair's device could not be recorded with its new grant. The pair still
   * reaches the device: its refresh key is spent, and the device would lose its session.
   */
  readonly onDeviceFailure: (error: DataError) => void
  /** Times the pairs parked for a retry out. */
  readonly clock: Clock
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

/** How long a renewed pair the device could not take waits for its next hello. */
const PARKED_MS = 60_000

/** A refresh key of the database: `surreal-refresh-<grant id>-<secret>`. */
const REFRESH_KEY = /^surreal-refresh-([^-]+)-.+$/

/**
 * The id of the refresh grant a refresh key belongs to, its second segment, read without a
 * statement; `undefined` for anything that is not a refresh key.
 */
export function grantIdOf(refresh: string): string | undefined {
  return REFRESH_KEY.exec(refresh)?.[1]
}

/** A pair parked for a device, until the moment it is no longer handed out. */
interface Parked {
  readonly device: string
  readonly tokens: DeviceTokens
  readonly until: number
}

/**
 * Where a pair is parked: the device and a digest of the refresh key the renewal spent, so the
 * key itself is never held.
 */
function parkingOf(device: string, refresh: string): string {
  return `${device}#${createHash('sha256').update(refresh).digest('hex')}`
}

function refused(message: string, cause?: unknown): DataError {
  return dataError('data:AUTH_FAILED', message, cause)
}

/** A revoke the database never judged: it could not be reached, or answered nothing readable. */
function notRevoked(message: string, cause?: unknown): DataError {
  return dataError('data:WRITE_FAILED', message, cause)
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
    return errAsync(notRevoked(`the database answered the revoke with status ${response.status}`))
  }

  return ResultAsync.fromPromise(response.json() as Promise<unknown>, (cause) =>
    notRevoked('the answer to the revoke is not JSON', cause),
  )
}

function revoked(answer: unknown): Result<void, DataError> {
  const parsed = rpcAnswer.safeParse(answer)

  if (!parsed.success) {
    return err(notRevoked('the answer to the revoke has an unknown shape'))
  }

  // The database's message is left out: it may name the grant.
  return parsed.data.error
    ? err(refused('the database refused to revoke the grant'))
    : ok(undefined)
}

/**
 * Identities as the gateway serves them to devices. Every call runs on a database session
 * of its own that is closed when the call ends, so no call sees another's identity and the
 * connection keeps no session per device. A sign-up, a sign-in and a renewal record the device
 * with the grant its new pair holds. A renewed pair the device could not take is parked for a
 * minute, for the device's next hello with the refresh key the renewal spent. Nothing here
 * logs, and no error carries a key.
 */
export class IdentitySessions {
  readonly #openAuth: () => AuthPort
  readonly #onCloseFailure: (error: DataError) => void
  readonly #devices: Pick<DeviceSessions, 'touch'>
  readonly #onDeviceFailure: (error: DataError) => void
  readonly #clock: Clock
  readonly #post: (url: string, init: RequestInit) => ResultAsync<Response, DataError>
  readonly #rpcUrl: string
  /** The pairs parked for a retry, by device and the digest of the spent refresh key. */
  readonly #parked = new Map<string, Parked>()

  constructor(options: IdentitySessionsOptions) {
    this.#openAuth = options.openAuth
    this.#onCloseFailure = options.onCloseFailure
    this.#devices = options.devices
    this.#onDeviceFailure = options.onDeviceFailure
    this.#clock = options.clock
    this.#rpcUrl = options.rpcUrl
    this.#post = ResultAsync.fromThrowable(options.fetch, (cause) =>
      notRevoked('the database could not be reached to revoke the grant', cause),
    )
  }

  /** Signs an identity up on `device`, which is recorded with the grant of its pair. */
  signUp(input: SignUpInput, device: SignInDevice): ResultAsync<SignedIn, DataError> {
    return this.#withAuth((auth) =>
      auth.signUp(input).andThen((identity) => signedIn(auth, identity)),
    ).andThen((signed) => this.#recordDevice(signed, device))
  }

  /** Signs an identity in on `device`, which is recorded with the grant of its pair. */
  signIn(input: SignInInput, device: SignInDevice): ResultAsync<SignedIn, DataError> {
    return this.#withAuth((auth) =>
      auth.signIn(input).andThen((identity) => signedIn(auth, identity)),
    ).andThen((signed) => this.#recordDevice(signed, device))
  }

  /**
   * Accepts the access token, or renews the pair with the refresh key when the token no longer
   * works; a renewal records `device` with the grant of the new pair. A call with an access
   * token only never renews, and names no device.
   */
  authenticate(tokens: {
    readonly access: string
    readonly refresh?: never
  }): ResultAsync<AuthenticatedDevice, DataError>
  authenticate(
    tokens: { readonly access: string; readonly refresh?: string },
    device: string,
  ): ResultAsync<AuthenticatedDevice, DataError>
  authenticate(
    tokens: { readonly access: string; readonly refresh?: string },
    device?: string,
  ): ResultAsync<AuthenticatedDevice, DataError> {
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
    ).andThen((authenticated) =>
      authenticated.renewed && device !== undefined
        ? this.#recordRenewal(authenticated, device)
        : okAsync(authenticated),
    )
  }

  /**
   * Parks the renewed pair `tokens` that `device` could not take, for its next hello with the
   * refresh key the renewal spent; it is handed out once, within 60 seconds.
   */
  park(input: {
    readonly device: string
    readonly spentRefresh: string
    readonly tokens: DeviceTokens
  }): void {
    const now = this.#clock.now()

    for (const [key, parked] of this.#parked) {
      if (parked.until <= now) {
        this.#parked.delete(key)
      }
    }

    this.#parked.set(parkingOf(input.device, input.spentRefresh), {
      device: input.device,
      tokens: input.tokens,
      until: now + PARKED_MS,
    })
  }

  /**
   * The pair parked for `device` and the spent refresh key it presents, taken out; `undefined`
   * when none is parked or it waited longer than 60 seconds.
   */
  parked(input: { readonly device: string; readonly refresh: string }): DeviceTokens | undefined {
    const key = parkingOf(input.device, input.refresh)
    const parked = this.#parked.get(key)

    this.#parked.delete(key)

    return parked && parked.until > this.#clock.now() ? parked.tokens : undefined
  }

  /** Forgets every pair parked for `device`: it was signed out. */
  unpark(device: string): void {
    for (const [key, parked] of this.#parked) {
      if (parked.device === device) {
        this.#parked.delete(key)
      }
    }
  }

  /**
   * Revokes the device's refresh grant through the database's RPC `revoke`. A pair the database
   * refuses (its grant revoked already, or no pair at all) fails with `data:AUTH_FAILED`; a
   * database that cannot be reached or answers nothing readable, with `data:WRITE_FAILED`.
   */
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
   * Records the device of a sign-up or sign-in with the grant of its pair. A device that cannot
   * be recorded fails the sign-in: every signed-in device is on its identity's list, where it can
   * be signed out.
   */
  #recordDevice(signed: SignedIn, device: SignInDevice): ResultAsync<SignedIn, DataError> {
    const grant = grantIdOf(signed.tokens.refresh)

    if (grant === undefined) {
      return errAsync(refused('the refresh key of the sign-in names no grant'))
    }

    return this.#devices
      .touch({ identity: signed.identity.id, device: device.id, label: device.label, grant })
      .map(() => signed)
  }

  /**
   * Records the device of a renewed pair with the new grant; a failure is reported, not
   * returned: the refresh key the device held is spent, and the new pair must reach it.
   */
  #recordRenewal(
    renewed: AuthenticatedDevice & { readonly renewed: true },
    device: string,
  ): ResultAsync<AuthenticatedDevice, DataError> {
    const identity: IdentityId = renewed.identity.id
    const grant = grantIdOf(renewed.tokens.refresh)
    const recorded =
      grant === undefined
        ? errAsync<unknown, DataError>(refused('the renewed refresh key names no grant'))
        : this.#devices.touch({ identity, device, grant })

    return recorded
      .orElse((error) => {
        this.#onDeviceFailure(error)

        return okAsync(undefined)
      })
      .map(() => renewed)
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
