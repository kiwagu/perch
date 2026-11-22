/** What the two halves of a passkey sign-in answer: the options of the browser's window, and the device signed in. */

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { passkeyRequestOptions } from '../passkey-ceremony'

import { ACCOUNT_BANNED_CODE, accountBanned, answerBody } from './answer-body'
import { type StepReading, signInStepOf } from './sign-in-step'
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

/**
 * What the passkey sign-in answers besides a device signed in, by status and code: a passkey no
 * account holds, and the ban of its account. The email's failed sign-ins never keep a passkey out,
 * so this door answers no 429, and an assertion the gateway refused (400 `failed`) is a failed
 * attempt like any other answer.
 */
const STEP: StepReading = {
  refusals: new Map([
    [
      '401 passkey-unknown',
      () => dataError('data:PASSKEY_UNKNOWN', 'no account holds the passkey'),
    ],
    [`403 ${ACCOUNT_BANNED_CODE}`, accountBanned],
  ]),
  // A confirmation holds only for the account the dialog asked about: one that names none cannot
  // be confirmed, so it is no outcome.
  deviceLimit: (body) => {
    const named = consent.safeParse(body)

    return named.success ? { kind: 'device-limit', consentFor: named.data.consentFor } : undefined
  },
}

/**
 * The sign-in's answer: the device signed in (200); the limit of devices with the account it
 * asked about (409 `device-limit` with `consentFor`, the account's identity); a passkey no
 * account holds (401 `passkey-unknown`); the account's ban (403 `account-banned`); any other
 * answer, an assertion the gateway refused (400 `failed`) included, fails naming its status.
 */
export function passkeySignedInOf(response: Response): ResultAsync<StepAnswer, DataError> {
  return signInStepOf(response, STEP)
}
