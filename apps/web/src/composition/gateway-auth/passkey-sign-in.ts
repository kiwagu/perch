/** What the two halves of a passkey sign-in answer: the options of the browser's window, and the device signed in. */

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { passkeyRequestOptions } from '../passkey-ceremony'

import { answerBody } from './answer-body'
import { type StepRefusals, signInStepOf } from './sign-in-step'
import type { StepAnswer } from './signed-in'

/** The options the browser's window takes, with the challenge that goes back with its answer. */
export interface PasskeyOptions {
  readonly options: PublicKeyCredentialRequestOptionsJSON
  /** Opaque to the device: the gateway's, carried back with the assertion. */
  readonly challenge: string
}

const optionsAnswer = z.object({
  options: passkeyRequestOptions,
  challenge: z.string().min(1),
})

/**
 * The options (200); any other answer fails naming its status. The answer names nothing the
 * device keeps, and an answer that does not read as options is quoted nowhere.
 */
export function passkeyOptionsOf(response: Response): ResultAsync<PasskeyOptions, DataError> {
  if (response.status !== 200) {
    return errAsync(
      dataError(
        'data:AUTH_FAILED',
        `the gateway refused the passkey options with ${response.status}`,
      ),
    )
  }

  return answerBody(response).andThen((body) => {
    const parsed = optionsAnswer.safeParse(body)

    return parsed.success
      ? okAsync(parsed.data)
      : errAsync(
          dataError(
            'data:AUTH_FAILED',
            'the gateway answered with something other than passkey options',
          ),
        )
  })
}

/** What the limit of devices names for a passkey: the account the dialog asks about. */
const consent = z.object({ consentFor: idSchemas.identity.schema })

/** A passkey no account holds is its own answer; the other refusals are the step's common ones. */
const REFUSALS: StepRefusals = new Map([
  ['401 passkey-unknown', () => dataError('data:PASSKEY_UNKNOWN', 'no account holds the passkey')],
])

/**
 * The sign-in's answer: the device signed in (200); the limit of devices with the account it
 * asked about (409 `consentFor`; one that names none cannot be confirmed, so it fails); a passkey
 * no account holds (401 `passkey-unknown`); the account's ban (403 `account-banned`); a request to
 * wait (429); any other answer, an assertion the gateway refused included (400 `failed`), fails
 * naming its status.
 */
export function passkeySignedInOf(response: Response): ResultAsync<StepAnswer, DataError> {
  if (response.status !== 409) {
    return signInStepOf(response, REFUSALS)
  }

  return answerBody(response).andThen((body) => {
    const named = consent.safeParse(body)

    return named.success
      ? okAsync<StepAnswer, DataError>({ kind: 'device-limit', consentFor: named.data.consentFor })
      : errAsync<StepAnswer, DataError>(
          dataError('data:AUTH_FAILED', 'the limit of devices named no account'),
        )
  })
}
