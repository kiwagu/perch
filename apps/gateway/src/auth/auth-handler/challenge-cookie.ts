import { err, ok, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { FRONT_PREFIX } from '../../config'
import type { AuthInstance } from '../auth-instance'
import { reading, writing } from '../device-session-rows'
import { ADMISSION_HEADER, DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'
import challengeEndStatement from '../surql/two-factor-challenge-end.surql'
import challengeOwnerStatement from '../surql/two-factor-challenge-owner.surql'
import challengeStateStatement from '../surql/two-factor-challenge-state.surql'
import challengesReclaimStatement from '../surql/two-factor-challenges-reclaim.surql'

/**
 * The key Better Auth's two-factor plugin names its cookie by, which carries a password step's
 * challenge; Better Auth puts its namespace and, on an https base URL, a secure prefix around it
 * (`createAuthCookie`).
 */
const TWO_FACTOR_COOKIE = 'two_factor'

/**
 * One cookie value as it stands on the wire: only the octets a cookie value may hold (visible
 * ASCII but the quote, the comma, the semicolon and the backslash; no whitespace, no control
 * character). Better Auth's signed value, percent-encoded, is one; a value holding a separator
 * would add a cookie to a call, or split the one it carries.
 */
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/

/** A cookie's name: an HTTP token. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/**
 * A challenge as a device carries it back: one cookie value on the wire (`COOKIE_VALUE`), kept byte
 * for byte. A route parses what the device sent with it before the challenge reaches a call.
 */
export const challengeValue = z.string().regex(COOKIE_VALUE)

/**
 * The value cookie `name` is set to by `answer`'s `set-cookie`, as it stands there: never decoded
 * nor trimmed, so it goes back to Better Auth exactly as Better Auth set it, which decodes it on its
 * read. The last setting of the name counts; none when the answer sets no such cookie, empties it,
 * or sets it to what is not one cookie value (`challengeValue`), a value padded with whitespace
 * included.
 */
export function setCookieValue(answer: Response, name: string): string | undefined {
  let value: string | undefined

  for (const cookie of answer.headers.getSetCookie()) {
    const [pair = ''] = cookie.split(';', 1)
    const equals = pair.indexOf('=')

    if (equals > 0 && pair.slice(0, equals).trim() === name) {
      const set = challengeValue.safeParse(pair.slice(equals + 1))

      value = set.success ? set.data : undefined
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

/** The codes Better Auth's verifiers count on one challenge: the next one after them ends it. */
const CODES_PER_CHALLENGE = 5

const challengeState = z.object({
  expires_at: z.date().nullish(),
  attempts: z.object({ value: z.string(), expires_at: z.date() }).nullish(),
})

/**
 * Whether a pending two-factor challenge still takes a code at `at`, as Better Auth's verifiers
 * judge it before the code: its row and the row counting its codes are there and expire after
 * `at`, the count a whole number below `CODES_PER_CHALLENGE`. False for a value that names no
 * challenge; the signature is Better Auth's to check.
 */
export function challengeTakesCode(
  directory: LocalDb,
  challenge: string,
  at: Date,
): ResultAsync<boolean, DataError> {
  const identifier = challengeIdentifier(challenge)

  if (identifier === undefined) {
    return okAsync(false)
  }

  return reading(
    directory.db.query<[unknown]>(challengeStateStatement, { identifier }),
    'the state of a two-factor challenge could not be read',
  ).andThen(([value]) => {
    const state = challengeState.safeParse(fromDriverValue(value))

    if (!state.success) {
      return err(dataError('data:QUERY_FAILED', 'a two-factor challenge has an unknown shape'))
    }

    const { expires_at: expiry, attempts } = state.data
    const counted = Number(attempts?.value)
    const live = expiry != null && expiry > at && attempts != null && attempts.expires_at > at

    return ok(live && Number.isInteger(counted) && counted >= 0 && counted < CODES_PER_CHALLENGE)
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
 * How many rows of expired two-factor challenges one password step that writes a challenge reads
 * at most to reclaim them: each such step leaves one challenge (two rows, ending together) behind at
 * most, while the rows it reads end five challenges at least, so a backlog of unanswered ones
 * drains over the next steps.
 */
export const RECLAIMED_PER_CHALLENGE = 10

/**
 * Ends some of the two-factor challenges password steps wrote and no code step answered, once they
 * expired more than a minute ago: at most `RECLAIMED_PER_CHALLENGE` of their rows are read, through
 * the index of the ceremonies' expiry, and each ends its challenge with the row counting its codes
 * (`fn::two_factor_challenge_end`). Better Auth's own clean-up of expired rows is off, so nothing
 * else reclaims them. No row of another kind is touched.
 */
export function reclaimChallenges(directory: LocalDb): ResultAsync<void, DataError> {
  return writing(
    directory.db.query(challengesReclaimStatement, { limit: RECLAIMED_PER_CHALLENGE }).retry(),
    'the expired two-factor challenges could not be reclaimed',
  ).map(() => undefined)
}

/**
 * Better Auth's two-factor challenges as the auth mount meets them: the name of the cookie that
 * carries one, the account one belongs to (`challengeOwner`), whether one still takes a code
 * (`challengeTakesCode`), the end of one (`endChallenge`), and the reclaim of those left
 * unanswered once expired (`reclaimChallenges`).
 */
export interface TwoFactorChallenges {
  /** The name of Better Auth's two-factor cookie, its namespace and any secure prefix included. */
  cookieName(): Promise<string>
  ownerOf(challenge: string): ResultAsync<IdentityId | undefined, DataError>
  takesCode(challenge: string, at: Date): ResultAsync<boolean, DataError>
  end(challenge: string): ResultAsync<void, DataError>
  reclaim(): ResultAsync<void, DataError>
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
    takesCode: (challenge, at) => challengeTakesCode(directory, challenge, at),
    end: (challenge) => endChallenge(directory, challenge),
    reclaim: () => reclaimChallenges(directory),
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
  /**
   * The challenge the device carried, the call's only cookie, in the wire form Better Auth set:
   * one cookie value (`challengeValue`) under a cookie's name, else no call is built.
   */
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
 * carried. A challenge that is not one cookie value under a cookie's name is refused with an error
 * and no request is built: such a value could carry a second cookie, a session's among them, which
 * would change what Better Auth does with the call.
 */
export function internalRequest(call: InternalCall): Request {
  if (
    call.challenge !== undefined &&
    (!COOKIE_NAME.test(call.challenge.name) ||
      !challengeValue.safeParse(call.challenge.value).success)
  ) {
    throw new Error('the challenge of an internal call must be one cookie value under a name')
  }

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
