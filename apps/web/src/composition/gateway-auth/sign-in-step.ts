/**
 * What the gateway's own answer to a step of a sign-in means (the code step, the passkey sign-in):
 * the device it signed in, the limit of devices as an answer, or why nothing was signed in. Each
 * outcome is recognised by the status and the code the gateway sends for it at that endpoint; any
 * other answer is a failed attempt naming its status. The steps' answers carry tokens, codes and
 * challenges, so an error names the status or the step's own code alone, never what was sent or
 * answered.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import { answerBody, codeIn } from './answer-body'
import {
  DEVICE_LIMIT_CODE,
  type Refusals,
  refusalMeant,
  type StepAnswer,
  signedInBody,
} from './signed-in'

/** What a step knows of its own: its refusals, and how its 409 names the limit of devices. */
export interface StepReading {
  readonly refusals: Refusals
  /** The limit of devices as the body of a 409 `device-limit` says it; none when it is unreadable. */
  readonly deviceLimit: (body: unknown) => StepAnswer | undefined
}

/**
 * A step's answer: the device signed in (200); the limit of devices (409 `device-limit`, read as
 * the step says); a refusal the step names by status and code; any other answer fails naming its
 * status.
 */
export function signInStepOf(
  response: Response,
  step: StepReading,
): ResultAsync<StepAnswer, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen(signedInBody)
  }

  return answerBody(response).andThen((body) => {
    const code = codeIn(body)
    const limit =
      response.status === 409 && code === DEVICE_LIMIT_CODE ? step.deviceLimit(body) : undefined

    return limit
      ? okAsync<StepAnswer, DataError>(limit)
      : errAsync<StepAnswer, DataError>(refusalMeant(step.refusals, response.status, code))
  })
}
