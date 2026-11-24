/**
 * What a change of the signed-in account answers (its password, its email, the request to delete
 * it): made or asked for, or why not. The request carries a password, so an error names the status
 * or the gateway's code, never what was sent.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { conflictRefusedBy, refusalCode } from './answer-body'

/** What a 400 means, by the code the gateway names. */
function refused(code: string | undefined): DataError {
  switch (code) {
    case 'invalid-credentials':
      return dataError('data:INVALID_CREDENTIALS', 'the current password is wrong')
    case 'password-rejected':
      return dataError('data:PASSWORD_REJECTED', 'the new password breaks the rules')
    case 'email-invalid':
      return dataError('data:EMAIL_INVALID', 'the new email is not an email')
    default:
      return dataError('data:WRITE_REJECTED', 'the gateway refused the change (400)')
  }
}

/** An answer the gateway gave that the change did not expect: only its status is named. */
const failed = (status: number) =>
  dataError('data:WRITE_FAILED', `the gateway could not make the change (${status})`)

/**
 * Done (`done`: 204 for a change of the password, 202 for a change of the email or of the
 * deletion asked); a refusal of what it carries (400, by its code); an account that is the only
 * administrator of an organisation with other members (409 `last-admin`); a token the gateway no
 * longer takes (401); a request to wait (429); any other answer fails naming its status.
 */
export function accountChangeOf(response: Response, done: 202 | 204): ResultAsync<void, DataError> {
  if (response.status === done) {
    return okAsync(undefined)
  }

  if (response.status === 400) {
    return refusalCode(response).andThen((code) => errAsync<void, DataError>(refused(code)))
  }

  if (response.status === 409) {
    return conflictRefusedBy(response, failed(409)).andThen((refused) =>
      errAsync<void, DataError>(refused),
    )
  }

  return errAsync(
    response.status === 401
      ? dataError('data:AUTH_FAILED', 'the gateway refused the session token')
      : response.status === 429
        ? dataError('data:RATE_LIMITED', 'the gateway asks to wait before the change')
        : failed(response.status),
  )
}
