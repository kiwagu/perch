/**
 * What a sign-up answers: accepted, or why not. The gateway answers every sign-up it accepts
 * alike, whether the email is new or has an account, and signs nothing in; an error names the
 * status alone, never the email or the password.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

/**
 * Accepted (202); refused for what it carries (400, 422); a request to wait (429); any other
 * answer fails naming its status.
 */
export function signedUpOf(response: Response): ResultAsync<void, DataError> {
  if (response.status === 202) {
    return okAsync(undefined)
  }

  if (response.status === 400 || response.status === 422) {
    return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
  }

  return errAsync(
    response.status === 429
      ? dataError('data:RATE_LIMITED', 'too many attempts')
      : dataError('data:AUTH_FAILED', `the gateway refused the request with ${response.status}`),
  )
}
