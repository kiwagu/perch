/**
 * What a step of a sign-in answers: the device the gateway signed in, or why it did not. The
 * limit of devices and the ask for a code are answers, not failures: nothing is signed in.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError } from '@workspace/data'
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

/**
 * What a step of a sign-in that follows the password (the code step, a passkey) came to when the
 * gateway took it.
 */
export type StepAnswer =
  | { readonly kind: 'signed-in'; readonly device: SignedInDevice }
  /**
   * The account is signed in on as many devices as it may be; a passkey sign-in names the account
   * it asked about (`consentFor`), which a confirmation must name.
   */
  | { readonly kind: 'device-limit'; readonly consentFor?: string }

/**
 * What the password step came to: a step's answer, or the ask for a code of an account whose
 * second factor is on, with the challenge its code step carries; nothing is signed in then.
 */
export type SignInAnswer =
  | StepAnswer
  | { readonly kind: 'code-required'; readonly challenge: string }

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

/** What the password step answers when the account asks for a code: its challenge, signing nothing in. */
const codeAsked = z.object({ secondFactor: z.object({ challenge: z.string().min(1) }) })

/** The refusals of one endpoint that mean something, by the status and the code its body names. */
export type Refusals = ReadonlyMap<`${number} ${string}`, () => DataError>

/** The code of the limit of devices, which the gateway answers 409 at every door. */
export const DEVICE_LIMIT_CODE = 'device-limit'

/**
 * What a refusal means: the one `refusals` names by its status and code, else a failed attempt
 * naming the status alone. A status without the code the gateway sends for it (a 403 of Better
 * Auth's origin check, a body that is no JSON) is never read as an outcome of its own.
 */
export function refusalMeant(refusals: Refusals, status: number, code: unknown): DataError {
  const meant = typeof code === 'string' ? refusals.get(`${status} ${code}`) : undefined

  return (
    meant?.() ?? dataError('data:AUTH_FAILED', `the gateway refused the request with ${status}`)
  )
}

/**
 * What the gateway answers a password sign-in with besides an account signed in, by status and
 * code: Better Auth's own code for wrong credentials and for an email not verified yet, the
 * gateway's for a banned account and for the email's failed sign-ins spent.
 */
const REFUSALS: Refusals = new Map([
  [
    '401 INVALID_EMAIL_OR_PASSWORD',
    () => dataError('data:INVALID_CREDENTIALS', 'wrong email or password'),
  ],
  [
    '403 EMAIL_NOT_VERIFIED',
    () => dataError('data:EMAIL_NOT_VERIFIED', 'the email is not verified yet'),
  ],
  [`403 ${ACCOUNT_BANNED_CODE}`, accountBanned],
  ['429 rate-limited', () => dataError('data:RATE_LIMITED', 'too many attempts')],
])

/**
 * The device the body of a sign-in step's 200 signed in. A body that is not a signed-in account
 * fails without the parser's account of it, which could quote the body.
 */
export function signedInBody(body: unknown): ResultAsync<StepAnswer, DataError> {
  const parsed = signedInAccount.safeParse(body)

  return parsed.success
    ? okAsync({
        kind: 'signed-in',
        device: {
          identity: { id: parsed.data.user.id, email: parsed.data.user.email },
          token: parsed.data.token,
          ...(parsed.data.start === undefined ? {} : { start: parsed.data.start }),
        },
      })
    : errAsync(
        dataError(
          'data:AUTH_FAILED',
          'the gateway answered with something other than a signed-in account',
        ),
      )
}

/**
 * What the password step answers: the device the gateway signed in, a challenge for the code of an
 * account whose second factor is on, the limit of devices as an answer (409 `device-limit`); a
 * refusal keeps its meaning only with the status and the code the gateway sends for it
 * (`REFUSALS`), any other answer is a failed attempt.
 */
export function signedIn(answer: ClientAnswer): ResultAsync<SignInAnswer, DataError> {
  if (answer.error) {
    const { status, code } = answer.error

    return status === 409 && code === DEVICE_LIMIT_CODE
      ? okAsync({ kind: 'device-limit' })
      : errAsync(refusalMeant(REFUSALS, status, code))
  }

  const asked = codeAsked.safeParse(answer.data)

  return asked.success
    ? okAsync({ kind: 'code-required', challenge: asked.data.secondFactor.challenge })
    : signedInBody(answer.data)
}
