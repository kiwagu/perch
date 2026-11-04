/**
 * What opening the link of an email confirmation answers: the account whose email changed and its
 * new email, or why the link changed nothing. The request carries the link's token, so an error
 * names the status alone.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { answerBody, linkRefusedBy } from './answer-body'

/** The account a confirmation changed the email of, and the email it has now. */
export interface EmailConfirmation {
  readonly identity: IdentityId
  readonly email: string
}

const confirmed = z.object({ identity: idSchemas.identity.schema, email: z.string().min(1) })

/**
 * Changed (200, with the account and its new email); a link past its day (401 `link-expired`) or
 * one that does not work (any other 401, a 400); a request to wait (429); any other answer fails
 * naming its status.
 */
export function emailConfirmationOf(response: Response): ResultAsync<EmailConfirmation, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen((body) => {
      const parsed = confirmed.safeParse(body)

      return parsed.success
        ? okAsync(parsed.data)
        : errAsync(
            dataError(
              'data:AUTH_FAILED',
              'the gateway answered the confirmation with something other than its outcome',
            ),
          )
    })
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) =>
      errAsync<EmailConfirmation, DataError>(refused),
    )
  }

  return errAsync(
    response.status === 400
      ? dataError('data:LINK_INVALID', 'the gateway refused the link')
      : response.status === 429
        ? dataError('data:RATE_LIMITED', 'the gateway asks to wait before the confirmation')
        : dataError(
            'data:AUTH_FAILED',
            `the gateway could not confirm the email (${response.status})`,
          ),
  )
}
