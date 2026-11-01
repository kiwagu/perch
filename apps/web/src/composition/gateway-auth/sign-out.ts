/** What the sign-out of a session token answers: signed out, dead already, refused for good, or to send again. */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

/**
 * Signed out (204); a token the gateway no longer takes (401) is dead already; a request to wait
 * (429) is no refusal for good; any other 4xx is a refusal the gateway will repeat, and any other
 * answer a failure: the token may be sent again. An error names the status, never the token.
 */
export function signedOutOf(response: Response): ResultAsync<void, DataError> {
  if (response.status === 204) {
    return okAsync(undefined)
  }

  if (response.status === 401) {
    return errAsync(dataError('data:AUTH_FAILED', 'the gateway no longer takes the token'))
  }

  // Asked to wait: the token is still live, so this is not a refusal for good.
  if (response.status === 429) {
    return errAsync(dataError('data:RATE_LIMITED', 'the gateway asks to wait before the sign-out'))
  }

  // Any other 4xx is a request the gateway will refuse however often it is sent.
  return errAsync(
    response.status >= 400 && response.status < 500
      ? dataError(
          'data:WRITE_REJECTED',
          `the gateway refused the sign-out of the token (${response.status})`,
        )
      : dataError(
          'data:WRITE_FAILED',
          `the gateway could not sign the token out (${response.status})`,
        ),
  )
}
