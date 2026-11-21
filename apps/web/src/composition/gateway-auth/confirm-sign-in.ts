/** What the code step of a sign-in answers: the device signed in, or why not. */

import type { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { ACCOUNT_BANNED_CODE, accountBanned } from './answer-body'
import { type StepReading, signInStepOf } from './sign-in-step'
import type { StepAnswer } from './signed-in'

/**
 * What the code step answers besides a device signed in, by status and code: a code the key does
 * not give counts as a failed sign-in, a dead challenge starts over from the password, a banned
 * account is refused after the right code, and the email's failed sign-ins spent keep it out.
 */
const STEP: StepReading = {
  refusals: new Map([
    ['400 invalid-code', () => dataError('data:INVALID_CODE', 'the code is wrong')],
    ['401 code-expired', () => dataError('data:CODE_EXPIRED', 'the sign-in must start again')],
    [`403 ${ACCOUNT_BANNED_CODE}`, accountBanned],
    ['429 rate-limited', () => dataError('data:RATE_LIMITED', 'too many attempts')],
  ]),
  // The code step names no account: its confirmation signs in again from the password.
  deviceLimit: () => ({ kind: 'device-limit' }),
}

/**
 * The code step's answer: the device signed in (200); the limit of devices (409 `device-limit`);
 * a wrong code (400 `invalid-code`); a challenge that is dead, or a code step that does not belong
 * to its email (401 `code-expired`); the account's ban (403 `account-banned`); the email's failed
 * sign-ins spent (429 `rate-limited`); any other answer, a 400 `bad-request` or a 500 `internal`
 * among them, fails naming its status.
 */
export function confirmedOf(response: Response): ResultAsync<StepAnswer, DataError> {
  return signInStepOf(response, STEP)
}
