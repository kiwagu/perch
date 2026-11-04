/**
 * What setting a new password with a reset link's token answers: set, or why not. The request
 * carries a password and a token, so an error names the status alone, never either.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { linkRefusedBy, refusalCode } from './answer-body'

/**
 * Set (204); a password that breaks the rules (400 `password-rejected`), the link kept; a link
 * past its hour (401 `link-expired`) or one that does not work (any other 401); a request to wait
 * (429); any other answer fails naming its status.
 */
export function passwordResetOf(response: Response): ResultAsync<void, DataError> {
  if (response.status === 204) {
    return okAsync(undefined)
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) => errAsync<void, DataError>(refused))
  }

  if (response.status === 400) {
    return refusalCode(response).andThen((code) =>
      errAsync<void, DataError>(
        code === 'password-rejected'
          ? dataError('data:PASSWORD_REJECTED', 'the new password breaks the rules')
          : dataError('data:WRITE_REJECTED', 'the gateway refused the reset (400)'),
      ),
    )
  }

  return errAsync(
    response.status === 429
      ? dataError('data:RATE_LIMITED', 'the gateway asks to wait before the reset')
      : dataError(
          'data:AUTH_FAILED',
          `the gateway could not reset the password (${response.status})`,
        ),
  )
}
