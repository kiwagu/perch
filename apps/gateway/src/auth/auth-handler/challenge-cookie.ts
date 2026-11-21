import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'

import { FRONT_PREFIX } from '../../config'
import type { AuthInstance } from '../auth-instance'
import { reading, writing } from '../device-session-rows'
import { ADMISSION_HEADER, DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'
import challengeEndStatement from '../surql/two-factor-challenge-end.surql'
import challengeOwnerStatement from '../surql/two-factor-challenge-owner.surql'

/**
 * The key Better Auth's two-factor plugin names its cookie by, which carries a password step's
 * challenge; Better Auth puts its namespace and, on an https base URL, a secure prefix around it
 * (`createAuthCookie`).
 */
const TWO_FACTOR_COOKIE = 'two_factor'

/**
 * The value cookie `name` is set to by `answer`'s `set-cookie`, as it stands there: never decoded,
 * so it goes back to Better Auth exactly as Better Auth set it, which decodes it on its read. The
 * last setting of the name counts; none when the answer sets no such cookie, or empties it.
 */
export function setCookieValue(answer: Response, name: string): string | undefined {
  let value: string | undefined

  for (const cookie of answer.headers.getSetCookie()) {
    const [pair = ''] = cookie.split(';', 1)
    const equals = pair.indexOf('=')

    if (equals > 0 && pair.slice(0, equals).trim() === name) {
      const set = pair.slice(equals + 1).trim()

      value = set === '' ? undefined : set
    }
  }

  return value
}

/**
 * The identifier a two-factor challenge names: the cookie's value decoded as Better Auth reads it,
 * the signature after its last `.` cut off. None for a value that names no challenge: one without a
 * signature, or whose identifier is not a challenge's (`2fa-<random>`), the row counting a
 * challenge's codes included.
 */
function challengeIdentifier(challenge: string): string | undefined {
  let decoded = challenge

  try {
    decoded = challenge.includes('%') ? decodeURIComponent(challenge) : challenge
  } catch {
    return undefined
  }

  const dot = decoded.lastIndexOf('.')
  const identifier = dot < 1 ? '' : decoded.slice(0, dot)

  return identifier.startsWith('2fa-') && !identifier.startsWith('2fa-attempts-')
    ? identifier
    : undefined
}

/**
 * The account a pending two-factor challenge belongs to, read from the challenge's own row in
 * `verification`, whose value is the identity's key: Better Auth's answer to a password step names
 * no account, so the gateway reads it here. None for a challenge whose row is gone (spent, ended, or
 * never there) and for a value that names no challenge. The signature is not checked here: Better
 * Auth checks it when the challenge is spent. A failure names nothing of the challenge.
 */
export function challengeOwner(
  directory: LocalDb,
  challenge: string,
): ResultAsync<IdentityId | undefined, DataError> {
  const identifier = challengeIdentifier(challenge)

  if (identifier === undefined) {
    return okAsync(undefined)
  }

  return reading(
    directory.db.query<[unknown]>(challengeOwnerStatement, { identifier }),
    'the account of a two-factor challenge could not be read',
  ).map(([value]) => {
    const owner = idSchemas.identity.schema.safeParse(value)

    return owner.success ? owner.data : undefined
  })
}

/**
 * Ends a pending two-factor challenge: its row and the row counting its codes go, so no code is
 * taken for it. Ending one that is gone, or a value that names none, ends nothing.
 */
export function endChallenge(directory: LocalDb, challenge: string): ResultAsync<void, DataError> {
  const identifier = challengeIdentifier(challenge)

  if (identifier === undefined) {
    return okAsync(undefined)
  }

  return writing(
    directory.db.query(challengeEndStatement, { identifier }).retry(),
    'a two-factor challenge could not be ended',
  ).map(() => undefined)
}

/**
 * Better Auth's two-factor challenges as the auth mount meets them: the name of the cookie that
 * carries one, the account one belongs to (`challengeOwner`), and the end of one (`endChallenge`).
 */
export interface TwoFactorChallenges {
  /** The name of Better Auth's two-factor cookie, its namespace and any secure prefix included. */
  cookieName(): Promise<string>
  ownerOf(challenge: string): ResultAsync<IdentityId | undefined, DataError>
  end(challenge: string): ResultAsync<void, DataError>
}

/**
 * The two-factor challenges of `auth` over `directory`, the cookie's name read from Better Auth's
 * own `createAuthCookie`, never written out here.
 */
export function twoFactorChallenges(
  auth: Pick<AuthInstance, '$context'>,
  directory: LocalDb,
): TwoFactorChallenges {
  return {
    cookieName: async () => (await auth.$context).createAuthCookie(TWO_FACTOR_COOKIE).name,
    ownerOf: (challenge) => challengeOwner(directory, challenge),
    end: (challenge) => endChallenge(directory, challenge),
  }
}

/** A call the gateway makes to one of Better Auth's plugin endpoints for a device. */
export interface InternalCall {
  /** The front's origin: the call goes to the auth routes behind it and names it as its origin. */
  readonly publicUrl: string
  /** Better Auth's path of the endpoint, such as `/two-factor/verify-totp`. */
  readonly path: string
  /** The device the call is made for, its headers validated before the call. */
  readonly device: { readonly id: string; readonly label: string }
  /** The challenge the device carried, the call's only cookie, in the wire form Better Auth set. */
  readonly challenge?: { readonly name: string; readonly value: string }
  /** The caller's validated session token, for a call made while signed in; a guest's has none. */
  readonly bearer?: string
  /** The session the call writes waits for the gateway's admission (`ADMISSION_HEADER`). */
  readonly pending?: boolean
  /** The JSON body of a POST; a call without one is a bodyless GET. */
  readonly body?: unknown
}

/**
 * The request of an internal call, built from nothing the device sent but what the call names: to
 * `${publicUrl}${FRONT_PREFIX}/auth${path}`, from the front's origin, with the device's id and
 * label, the challenge as the only cookie (its value as Better Auth set it, never decoded and
 * encoded again), the bearer when the call is made while signed in, and the ask to wait for the
 * admission when the call writes a session. No other header of the device's own request is
 * carried.
 */
export function internalRequest(call: InternalCall): Request {
  const headers = new Headers({
    origin: call.publicUrl,
    [DEVICE_HEADER]: call.device.id,
    [DEVICE_LABEL_HEADER]: call.device.label,
  })

  if (call.challenge !== undefined) {
    headers.set('cookie', `${call.challenge.name}=${call.challenge.value}`)
  }

  if (call.bearer !== undefined) {
    headers.set('authorization', `Bearer ${call.bearer}`)
  }

  if (call.pending === true) {
    headers.set(ADMISSION_HEADER, 'pending')
  }

  const url = `${call.publicUrl}${FRONT_PREFIX}/auth${call.path}`

  if (call.body === undefined) {
    return new Request(url, { method: 'GET', headers })
  }

  headers.set('content-type', 'application/json')

  return new Request(url, { method: 'POST', headers, body: JSON.stringify(call.body) })
}
