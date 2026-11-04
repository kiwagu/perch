/**
 * What the press of the deletion page's button answers: the account deleted, or why the link
 * deleted nothing. The request carries the link's token, so an error names the status alone.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { conflictRefusedBy, linkRefusedBy } from './answer-body'

/** An answer the gateway gave that the deletion did not expect: only its status is named. */
const failed = (status: number) =>
  dataError('data:AUTH_FAILED', `the gateway could not delete the account (${status})`)

/**
 * Deleted (200; the body, which names the account, is not read: nothing is left to do with it
 * once the account is gone); a link past its hour (401 `link-expired`) or one that does not work
 * (any other 401, a 400); an account that became the only administrator of an organisation with
 * other members (409 `last-admin`), the link kept; a request to wait (429); any other answer fails
 * naming its status.
 */
export function accountDeletedOf(response: Response): ResultAsync<void, DataError> {
  if (response.status === 200) {
    return okAsync(undefined)
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) => errAsync<void, DataError>(refused))
  }

  if (response.status === 409) {
    return conflictRefusedBy(response, failed(409)).andThen((refused) =>
      errAsync<void, DataError>(refused),
    )
  }

  return errAsync(
    response.status === 400
      ? dataError('data:LINK_INVALID', 'the gateway refused the link')
      : response.status === 429
        ? dataError('data:RATE_LIMITED', 'the gateway asks to wait before the deletion')
        : failed(response.status),
  )
}
