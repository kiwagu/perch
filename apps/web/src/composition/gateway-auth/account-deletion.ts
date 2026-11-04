/**
 * What the press of the deletion page's button answers: the account deleted, or why the link
 * deleted nothing. The request carries the link's token, so an error names the status alone.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { answerBody, conflictRefusedBy, linkRefusedBy } from './answer-body'

/** The account a deletion removed: the device signed in to it signs out of it. */
export interface DeletedAccount {
  readonly identity: IdentityId
}

const deleted = z.object({ identity: idSchemas.identity.schema })

/** An answer the gateway gave that the deletion did not expect: only its status is named. */
const failed = (status: number) =>
  dataError('data:AUTH_FAILED', `the gateway could not delete the account (${status})`)

/**
 * Deleted (200, with the account); a link past its hour (401 `link-expired`) or one that does not
 * work (any other 401, a 400); an account that became the only administrator of an organisation
 * with other members (409 `last-admin`), the link kept; a request to wait (429); any other answer
 * fails naming its status. A 200 that does not name the account fails too, though the account is
 * gone: without it this device cannot tell whether it was signed in to it.
 */
export function accountDeletedOf(response: Response): ResultAsync<DeletedAccount, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen((body) => {
      const parsed = deleted.safeParse(body)

      return parsed.success
        ? okAsync(parsed.data)
        : errAsync(
            dataError(
              'data:AUTH_FAILED',
              'the gateway answered the deletion with something other than its outcome',
            ),
          )
    })
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) =>
      errAsync<DeletedAccount, DataError>(refused),
    )
  }

  if (response.status === 409) {
    return conflictRefusedBy(response, failed(409)).andThen((refused) =>
      errAsync<DeletedAccount, DataError>(refused),
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
