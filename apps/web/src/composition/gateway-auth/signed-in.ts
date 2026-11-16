/** What a sign-in answers: the device the gateway signed in, or why it did not. */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, type DataErrorCode, dataError } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { ACCOUNT_BANNED_CODE, accountBanned } from './answer-body'

/** The account as it signed up: its name and its language, which its profile and settings start from. */
export interface AccountSignedUpAs {
  readonly name: string
  readonly locale: Locale
}

/**
 * A device the gateway signed in: who it is and the session token it presents. The session reads
 * the identity's memberships with the token once it keeps it.
 */
export interface SignedInDevice {
  readonly identity: AuthUser
  /** The raw session token of the answer's body, as the gateway keeps it for the device. */
  readonly token: string
  /**
   * What the account starts from, when a sign-in found it has no settings or profile at the
   * gateway yet: a reset verified its email, or the device that verified it has not synced its
   * start yet.
   */
  readonly start?: AccountSignedUpAs
}

/** The device a sign-in or verification names: the browser's own id, and a label for people to read. */
export interface NamedDevice {
  readonly id: string
  readonly label: string
}

/** The headers of a request that names the device: its id and its label. */
export const deviceHeaders = (device: NamedDevice) => ({
  'X-Perch-Device': device.id,
  'X-Perch-Device-Label': device.label,
})

/**
 * The sign-in's answer as Better Auth's client reads it: its body, or the status it refused with
 * and the `code` the refusal's body names, when it has one.
 */
export interface ClientAnswer {
  readonly data: unknown
  readonly error: { readonly status: number; readonly code?: unknown } | null
}

/**
 * What a successful sign-in answers with. Only the body's token is the session's own: the
 * `set-auth-token` header carries it signed, which the gateway's own routes do not match.
 */
const signedInAccount = z.object({
  token: z.string().min(1),
  user: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  start: z.object({ name: z.string().min(1), locale: z.enum(SUPPORTED_LOCALES) }).optional(),
})

/** The statuses the gateway refuses a sign-in with, and what each means here; a 403 is read apart. */
const REFUSALS: ReadonlyMap<number, { readonly code: DataErrorCode; readonly message: string }> =
  new Map([
    [401, { code: 'data:INVALID_CREDENTIALS', message: 'wrong email or password' }],
    // The account is signed in on as many devices as it may be: nothing is signed in.
    [
      409,
      {
        code: 'data:DEVICE_LIMIT',
        message: 'the account is signed in on as many devices as it may be',
      },
    ],
    [429, { code: 'data:RATE_LIMITED', message: 'too many attempts' }],
  ])

/**
 * What a 403 means: the password was right, and the body's code tells why nothing is signed in:
 * `account-banned` an account an operator banned, any other (a body that names none or does not
 * parse too) an email not verified yet.
 */
function forbidden(code: unknown): DataError {
  return code === ACCOUNT_BANNED_CODE
    ? accountBanned()
    : dataError('data:EMAIL_NOT_VERIFIED', 'the email is not verified yet')
}

function refused({ status, code }: NonNullable<ClientAnswer['error']>): DataError {
  if (status === 403) {
    return forbidden(code)
  }

  const refusal = REFUSALS.get(status)

  return refusal
    ? dataError(refusal.code, refusal.message)
    : dataError('data:AUTH_FAILED', `the gateway refused the request with ${status}`)
}

/**
 * The device a sign-in's answer signed in; a refusal keeps its meaning. An answer that is not a
 * signed-in account fails without the parser's account of it, which could quote the answer.
 */
export function signedIn(answer: ClientAnswer): ResultAsync<SignedInDevice, DataError> {
  if (answer.error) {
    return errAsync(refused(answer.error))
  }

  const parsed = signedInAccount.safeParse(answer.data)

  return parsed.success
    ? okAsync({
        identity: { id: parsed.data.user.id, email: parsed.data.user.email },
        token: parsed.data.token,
        ...(parsed.data.start === undefined ? {} : { start: parsed.data.start }),
      })
    : errAsync(
        dataError(
          'data:AUTH_FAILED',
          'the gateway answered with something other than a signed-in account',
        ),
      )
}
