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

import type { DeviceSessions } from './device-sessions'
import { issuedAtOf, namesOtherScope, type TokenScope } from './token-claims'

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

/**
 * Asked once the access token was refused and before the refresh key beside it is exchanged:
 * whether the renewal may go on. A renewal it refuses asks the database nothing and spends nothing.
 */
export type RenewalGate = () => boolean

/** A pair parked for a device, and the identity it signs in. */
export interface ParkedPair {
  readonly identity: IdentityId
  readonly tokens: DeviceTokens
}

export interface IdentitySessionsOptions {
  /** Opens an auth session of its own on the central database, through its identity access method. */
  readonly openAuth: () => AuthPort
  /**
   * Where each device an identity signs in on is recorded with the refresh grant its pair holds,
   * and where the grant it held before is revoked.
   */
  readonly devices: Pick<DeviceSessions, 'touch' | 'revokeGrant'>
  /** Where the identity access method issues tokens; a token issued elsewhere is refused. */
  readonly scope: TokenScope
  /** Times the pairs parked for a retry out. */
  readonly clock: Clock
  /**
   * Hears a failure that does not fail the call it happened in: an auth session that failed to
   * close after its call (the call keeps its result: the identity it signed up exists, and the
   * refresh key it renewed is spent), the grant a device held before a sign-in that could not be
   * revoked (the sign-in stands: its new pair is valid), or the grant a sign-in minted that could
   * not be revoked once its device failed to be recorded (the sign-in failed all the same).
   */
  readonly onFailure: (error: DataError) => void
}

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

/** A pair parked for a device of an identity, until the moment it is no longer handed out. */
interface Parked {
  readonly identity: IdentityId
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

/**
 * Whether a failure to accept keys refused them: the database judged them dead. Any other failure
 * judged nothing (the database could not be reached, the gateway failed, or a limit refused the
 * renewal), and the same keys may work once it answers again.
 */
export function keysRefused(error: DataError): boolean {
  return error.code === 'data:AUTH_FAILED'
}

/** A failure that judged no keys: the gateway or the database failed, the keys may still work. */
function unjudged(message: string, cause?: unknown): DataError {
  return dataError('data:QUERY_FAILED', message, cause)
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

/**
 * Identities as the gateway serves them to devices. Every call runs on a database session
 * of its own that is closed when the call ends, so no call sees another's identity and the
 * connection keeps no session per device. A sign-up and a sign-in record the device with the
 * grant its pair holds; a renewal records nothing here: the hello that renews binds the device
 * to its row. A renewed pair the device could not take is parked for a minute, for the device's
 * next hello with the refresh key the renewal spent. Keys the database refused fail with
 * `data:AUTH_FAILED`; a call it could not judge (it could not be reached, or the call failed in
 * the gateway) fails with `data:QUERY_FAILED`, and a renewal its gate refused with
 * `data:RATE_LIMITED`: the keys may still work. Nothing here logs, and no error carries a key.
 */
export class IdentitySessions {
  readonly #openAuth: () => AuthPort
  readonly #onFailure: (error: DataError) => void
  readonly #devices: Pick<DeviceSessions, 'touch' | 'revokeGrant'>
  readonly #clock: Clock
  readonly #scope: TokenScope
  /** The pairs parked for a retry, by device and the digest of the spent refresh key. */
  readonly #parked = new Map<string, Parked>()

  constructor(options: IdentitySessionsOptions) {
    this.#openAuth = options.openAuth
    this.#onFailure = options.onFailure
    this.#devices = options.devices
    this.#clock = options.clock
    this.#scope = options.scope
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
   * Accepts the access token, or renews the pair with the refresh key when the database refused
   * the token, once `renewal` lets it: a refresh key comes with its gate, and a renewal the gate
   * refuses fails `data:RATE_LIMITED`, its key unspent. A token the database could not judge
   * fails as it is, with no gate asked and nothing spent. It records nothing: the caller binds
   * the device to its row.
   */
  authenticate(tokens: {
    readonly access: string
    readonly refresh?: never
  }): ResultAsync<AuthenticatedDevice, DataError>
  authenticate(
    tokens: { readonly access: string; readonly refresh: string },
    renewal: RenewalGate,
  ): ResultAsync<AuthenticatedDevice, DataError>
  authenticate(
    tokens: { readonly access: string; readonly refresh?: string },
    renewal?: RenewalGate,
  ): ResultAsync<AuthenticatedDevice, DataError> {
    const { access, refresh } = tokens

    // The database would accept a token of another database's record access: refuse it first.
    if (namesOtherScope(access, this.#scope)) {
      return errAsync(refused('the access token names another namespace, database or access'))
    }

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
        .orElse((error) => {
          // Only a token the database refused is renewed: one it could not judge may still work.
          if (refresh === undefined || !keysRefused(error)) {
            return errAsync(error)
          }

          // The overloads give every refresh key its gate: one without is the gateway's failure.
          if (renewal === undefined) {
            return errAsync(unjudged('a refresh key came without its renewal gate'))
          }

          // Counted before the refresh key is exchanged: a refused renewal spends nothing.
          return renewal()
            ? renew(auth, { access, refresh })
            : errAsync(dataError('data:RATE_LIMITED', 'too many renewals'))
        }),
    )
  }

  /**
   * Parks the renewed pair `tokens` that `device` could not take, for its next hello with the
   * refresh key the renewal spent; it is handed out once, within 60 seconds.
   */
  park(input: {
    readonly identity: IdentityId
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
      identity: input.identity,
      device: input.device,
      tokens: input.tokens,
      until: now + PARKED_MS,
    })
  }

  /**
   * The pair parked for `device` and the spent refresh key it presents, taken out with the
   * identity it signs in; `undefined` when none is parked or it waited longer than 60 seconds.
   */
  parked(input: { readonly device: string; readonly refresh: string }): ParkedPair | undefined {
    const key = parkingOf(input.device, input.refresh)
    const parked = this.#parked.get(key)

    this.#parked.delete(key)

    return parked && parked.until > this.#clock.now()
      ? { identity: parked.identity, tokens: parked.tokens }
      : undefined
  }

  /**
   * Forgets every pair parked for `device` of `identity`, or for every device of the identity when
   * none is named: it was signed out.
   */
  unpark(identity: IdentityId, device?: string): void {
    for (const [key, parked] of this.#parked) {
      if (parked.identity === identity && (device === undefined || parked.device === device)) {
        this.#parked.delete(key)
      }
    }
  }

  /**
   * Records the device of a sign-up or sign-in with the grant of its pair and a new session that
   * started in the second its access token was issued in, forgets the pairs parked for the
   * device, and revokes the grant the device's row held before: a device holds one live grant, so
   * a pair it left behind (one it could not have revoked, or one parked for it) dies with the
   * sign-in, and an access token of an earlier session is refused from then on. A device that
   * cannot be recorded fails the sign-in, and the grant the sign-in minted is revoked: every live
   * grant is a device on its identity's list, where it can be signed out. A grant that cannot be
   * revoked is reported; an old one leaves the sign-in standing.
   */
  #recordDevice(signed: SignedIn, device: SignInDevice): ResultAsync<SignedIn, DataError> {
    const grant = grantIdOf(signed.tokens.refresh)

    if (grant === undefined) {
      return errAsync(refused('the refresh key of the sign-in names no grant'))
    }

    const identity = signed.identity.id
    /** Revokes `revoked` of the identity; a failure is reported and the answer stands. */
    const revoke = (revoked: string): ResultAsync<void, never> =>
      this.#devices.revokeGrant({ identity, grant: revoked }).orElse((error) => {
        this.#onFailure(error)

        return okAsync(undefined)
      })

    // The session starts when its first access token was issued: the touch comes later, maybe in
    // the next second, and its own time would make that token older than the session.
    const startedAt = issuedAtOf(signed.tokens.access)

    if (startedAt === undefined) {
      const unnamed = refused('the access token of the sign-in names no second it was issued in')

      return revoke(grant).andThen(() => errAsync(unnamed))
    }

    return this.#devices
      .touch({ identity, device: device.id, label: device.label, grant, startedAt })
      .orElse((error) => revoke(grant).andThen(() => errAsync(error)))
      .andThen(({ previous }) => {
        this.unpark(identity, device.id)

        return previous === undefined || previous === grant
          ? okAsync(signed)
          : revoke(previous).map(() => signed)
      })
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
          this.#onFailure(unjudged('the auth session could not be closed', cause))
        })
      }
    }

    // A call that threw judged no keys: it failed in the gateway or the driver.
    return ResultAsync.fromPromise(settled(), (cause) =>
      unjudged('the identity session failed', cause),
    ).andThen((result) => result)
  }
}
