import { TWO_FACTOR_ERROR_CODES } from 'better-auth/plugins/two-factor'

import type { IdentityId } from '@workspace/ids'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { SignInOutcome } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { DEVICE_HEADER, DEVICE_LABEL_HEADER, deviceLabel } from '../session-hooks'

import { acceptedSession, admitted } from './admitted'
import { challengeValue, internalRequest } from './challenge-cookie'
import type { AuthMountDeps } from './mount'
import { BANNED_USER, badRequest, internal, refusalCodeOf, refused } from './requests'
import { type JudgedAnswer, settling } from './sign-in-settlement'

/** The code step of a sign-in whose password step answered a challenge. */
export const CONFIRM_SIGN_IN_PATH = '/auth/confirm-sign-in'

const { minLength: CODE_MIN, maxLength: CODE_MAX } = CONTRACT_VALUES['second-factor-code']

/**
 * What a code step names: the challenge its password step answered, as the device carries it (one
 * cookie value, `challengeValue`), the email typed at that step, of at most the `email` value's
 * length, the code (as long as the contract's code of the second factor), and `signOutOldest`,
 * true once the person confirmed a sign-in past the account's limit of devices.
 */
const confirmBody = z.object({
  challenge: challengeValue,
  email: z.string().max(CONTRACT_VALUES.email.maxLength),
  code: z.string().min(CODE_MIN).max(CODE_MAX),
  signOutOldest: z.boolean().optional(),
})

/** Six digits are a code the account's authenticator app shows; any other code a backup code. */
const KEY_CODE = /^\d{6}$/

/** The step as the gateway takes it once its request was read. */
interface Step {
  readonly challenge: string
  /** The email typed at the password step, in lower case. */
  readonly email: string
  readonly code: string
  readonly signOutOldest: boolean
  readonly device: { readonly id: string; readonly label: string }
}

/** An answer with what it means for the email's failed sign-ins. */
const judged = (response: Response, outcome: SignInOutcome): JudgedAnswer => ({
  response,
  outcome,
})

/** 401 `code-expired`, judging nothing: the sign-in starts again from the password. */
const expired = (): JudgedAnswer => judged(refused(401, 'code-expired'), 'unjudged')

const failure = (): JudgedAnswer => judged(internal(), 'unjudged')

/** 403 `account-banned`, judging nothing: a banned account's right code forgets no failure. */
const banned = (): JudgedAnswer => judged(refused(403, 'account-banned'), 'unjudged')

/** 409 `device-limit` before the code is checked, judging nothing: no code was looked at. */
const pastTheLimit = (): JudgedAnswer => judged(refused(409, 'device-limit'), 'unjudged')

/** Better Auth's codes of the two-factor plugin's refusals. */
const CODES = TWO_FACTOR_ERROR_CODES

/**
 * Better Auth's refusals of a code, by their code: a wrong code (of the key or a backup code) is a
 * failed sign-in; a challenge spent, ended, past its time or after five wrong codes, and a factor
 * that is not on (in either verifier), start the sign-in again from the password and judge
 * nothing; the admin plugin's refusal of a banned account's session judges nothing either, so a
 * banned account's right code forgets none of the failures. Any other refusal is a failure of the
 * gateway's.
 */
const REFUSALS: ReadonlyMap<string, () => JudgedAnswer> = new Map([
  [CODES.INVALID_CODE.code, () => judged(refused(400, 'invalid-code'), 'failed')],
  [CODES.INVALID_BACKUP_CODE.code, () => judged(refused(400, 'invalid-code'), 'failed')],
  [CODES.TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE.code, expired],
  [CODES.INVALID_TWO_FACTOR_COOKIE.code, expired],
  [CODES.TOTP_NOT_ENABLED.code, expired],
  [CODES.BACKUP_CODES_NOT_ENABLED.code, expired],
  [CODES.TWO_FACTOR_NOT_ENABLED.code, expired],
  [BANNED_USER, banned],
])

/**
 * A step judged before its code is checked. A challenge that takes no code any more (past its ten
 * minutes, or after five wrong codes) ends and answers 401 `code-expired` before anything else is
 * judged. The sign-in is then judged as its admission would judge it (`AuthSessions.judge`): an
 * account banned ends the challenge and answers 403 `account-banned`, a confirmed step's
 * (`signOutOldest`) too; a device that would bring the account past the limit of devices, on a step
 * that does not confirm signing out the device seen least recently, ends it and answers 409
 * `device-limit`. No verifier runs then, so no code is checked or spent and the email's failed
 * sign-ins stay as they were; the sign-in starts again from the password, the dialog's
 * confirmation included. Otherwise nothing is answered here: a confirmed step checks its code before
 * anyone is signed in or out.
 */
async function prejudged(
  deps: AuthMountDeps,
  identity: IdentityId,
  step: Step,
): Promise<JudgedAnswer | undefined> {
  const live = await deps.challenges.takesCode(step.challenge)

  if (live.isErr()) {
    return failure()
  }

  if (!live.value) {
    return (await deps.challenges.end(step.challenge)).match(expired, failure)
  }

  const judgment = await deps.sessions.judge(identity, step.device.id)

  if (judgment.isErr()) {
    return failure()
  }

  if (judgment.value === 'banned') {
    return (await deps.challenges.end(step.challenge)).match(banned, failure)
  }

  if (judgment.value === 'asked' && !step.signOutOldest) {
    return (await deps.challenges.end(step.challenge)).match(pastTheLimit, failure)
  }

  return undefined
}

/**
 * The code step in the account's turn, so a change of the password, a reset, the confirmation of a
 * new email, a ban, a deletion and a change of the second factor commit wholly before it or after
 * it. The challenge's row is read again (gone: 401 `code-expired`), as is the account's second
 * factor: one that is off, or whose key no code confirmed, ends the challenge and answers 401
 * `code-expired` before either verifier runs (Better Auth's verifier of backup codes takes them of
 * an unconfirmed key too). The step is then judged before its code is checked (`prejudged`): the
 * challenge's time and count of codes, the ban, and on a step that does not confirm a sign-in past
 * the limit of devices, the limit. The code then goes to Better Auth's verifier (a code of the key, or a backup code) with the challenge as
 * the call's only cookie, the session it writes waiting for its admission; an accepted one is
 * admitted (`admitted`), with the start of the account the typed email names, read in the turn.
 */
async function verified(
  deps: AuthMountDeps,
  request: Request,
  identity: IdentityId,
  step: Step,
): Promise<JudgedAnswer> {
  const again = await deps.challenges.ownerOf(step.challenge)
  const factor = await deps.twoFactor.read(identity)
  const account = await deps.passwords.credentialOf(step.email)

  if (again.isErr() || factor.isErr() || account.isErr()) {
    return failure()
  }

  if (again.value !== identity || account.value?.identity !== identity) {
    return expired()
  }

  if (!factor.value.enabled || factor.value.key?.verified !== true) {
    return (await deps.challenges.end(step.challenge)).match(expired, failure)
  }

  const refusal = await prejudged(deps, identity, step)

  if (refusal !== undefined) {
    return refusal
  }

  const answer = await deps.auth.handler(
    internalRequest({
      publicUrl: deps.publicUrl,
      path: KEY_CODE.test(step.code) ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code',
      device: step.device,
      challenge: { name: await deps.challenges.cookieName(), value: step.challenge },
      pending: true,
      body: { code: step.code },
    }),
  )

  if (answer.status !== 200) {
    return REFUSALS.get((await refusalCodeOf(answer)) ?? '')?.() ?? failure()
  }

  const accepted = acceptedSession.safeParse(await answer.json().catch(() => undefined))

  if (!accepted.success) {
    return failure()
  }

  const response = await admitted(
    deps,
    request,
    accepted.data,
    account.value.start,
    step.signOutOldest,
  )

  // The right code is a sign-in's last step: admitted, or asked about the limit of devices, it
  // forgets the email's failed sign-ins; a ban the admission read, or a failure, judges nothing.
  // The admission still asks, or finds the account banned, when another change of the account
  // commits while the code is checked, after `prejudged`: a device's session renewed or admitted
  // through a door that does not take the account's turn, a ban. The code is spent by then, and
  // nothing is signed in.
  return judged(
    response,
    response.status === 200 || response.status === 409 ? 'succeeded' : 'unjudged',
  )
}

/**
 * The challenge's account, by its own row, and the account the typed email names: a challenge
 * whose row is gone (spent, ended, never there), or whose account the email does not name, answers
 * 401 `code-expired` before any turn is asked; otherwise the step runs in that account's turn
 * (`verified`).
 */
async function stepped(deps: AuthMountDeps, request: Request, step: Step): Promise<JudgedAnswer> {
  const owner = await deps.challenges.ownerOf(step.challenge)
  const account = await deps.passwords.credentialOf(step.email)

  if (owner.isErr() || account.isErr()) {
    return failure()
  }

  const identity = owner.value

  if (identity === undefined || account.value?.identity !== identity) {
    return expired()
  }

  return deps.accounts.run(identity, () => verified(deps, request, identity, step))
}

/**
 * The code step of a sign-in whose password step answered a challenge (`{ challenge, email, code,
 * signOutOldest? }`, with the device's headers). A body that is not the schema's, or a request
 * that names no valid device, answers 400 `bad-request` before anything is read or spent. The
 * email, in lower case, must then find a place among its failed sign-ins (`RequestLimits.
 * signInAttempt`, 429 `rate-limited` once spent, whatever the challenge and the code), the place
 * settled once with what the step meant (`settling`): a wrong code (400 `invalid-code`) counts as
 * a failed sign-in, a right one (200 signed in, or 409 `device-limit` from an admission a device
 * admitted meanwhile made ask) forgets them, and every other answer gives the place back: 409
 * `device-limit` judged before the code was checked, 401 `code-expired` (a challenge dead, of
 * another email's account, after five wrong codes, past its ten minutes, or of a factor that is
 * not on), 403 `account-banned`, 500 `internal`, a throw.
 */
export async function confirmSignIn(deps: AuthMountDeps, request: Request): Promise<Response> {
  const body = confirmBody.safeParse(await readBody(request))
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (!body.success || !device.success) {
    return badRequest()
  }

  const label = deviceLabel.safeParse(request.headers.get(DEVICE_LABEL_HEADER) ?? '')
  const email = body.data.email.toLowerCase()
  const attempt = deps.limits.signInAttempt(email)

  if (!attempt.allowed) {
    return tooMany(attempt)
  }

  return settling(deps, email, attempt, () =>
    stepped(deps, request, {
      challenge: body.data.challenge,
      email,
      code: body.data.code,
      signOutOldest: body.data.signOutOldest ?? false,
      device: { id: device.data, label: label.success ? label.data : '' },
    }),
  )
}
