/**
 * What the gateway's own answer to a step of a sign-in means (the code step, the passkey sign-in):
 * the device it signed in, the limit of devices as an answer, or why nothing was signed in. The
 * steps' answers carry tokens, codes and challenges, so an error names the status or the step's
 * own code alone, never what was sent or answered.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { ACCOUNT_BANNED_CODE, accountBanned, answerBody, refusalCode } from './answer-body'
import { type StepAnswer, signedInBody } from './signed-in'

/** The refusals one step makes of its own, by the status and the code its body names. */
export type StepRefusals = ReadonlyMap<`${number} ${string}`, () => DataError>

/**
 * A step's answer: the device signed in (200); the limit of devices (409); a refusal the step
 * names (`own`), the ban of the account (403 `account-banned`) or a request to wait (429); any
 * other answer fails naming its status.
 */
export function signInStepOf(
  response: Response,
  own: StepRefusals,
): ResultAsync<StepAnswer, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen(signedInBody)
  }

  if (response.status === 409) {
    return okAsync({ kind: 'device-limit' })
  }

  return refusalCode(response).andThen((code) => {
    const mine = own.get(`${response.status} ${code}`)

    if (mine) {
      return errAsync<StepAnswer, DataError>(mine())
    }

    if (response.status === 403 && code === ACCOUNT_BANNED_CODE) {
      return errAsync<StepAnswer, DataError>(accountBanned())
    }

    return errAsync<StepAnswer, DataError>(
      response.status === 429
        ? dataError('data:RATE_LIMITED', 'too many attempts')
        : dataError('data:AUTH_FAILED', `the gateway refused the request with ${response.status}`),
    )
  })
}
