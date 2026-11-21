/** What the code step of a sign-in answers: the device signed in, or why not. */

import type { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { type StepRefusals, signInStepOf } from './sign-in-step'
import type { StepAnswer } from './signed-in'

/** A code the key does not give counts as a failed sign-in; a dead challenge starts over from the password. */
const REFUSALS: StepRefusals = new Map([
  ['400 invalid-code', () => dataError('data:INVALID_CODE', 'the code is wrong')],
  ['401 code-expired', () => dataError('data:CODE_EXPIRED', 'the sign-in must start again')],
])

/**
 * The code step's answer: the device signed in (200); the limit of devices (409); a wrong code
 * (400 `invalid-code`); a challenge that is dead, or a code step that does not belong to its
 * email (401 `code-expired`); the account's ban (403 `account-banned`); the email's failed
 * sign-ins spent (429); any other answer fails naming its status.
 */
export function confirmedOf(response: Response): ResultAsync<StepAnswer, DataError> {
  return signInStepOf(response, REFUSALS)
}
