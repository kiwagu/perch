/**
 * What a request for the verification mail again answers: accepted, or why not. The gateway
 * answers alike whatever the email names, and an error names the status alone, never the email.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

/**
 * Accepted (202); a request to wait (429); another 4xx is a refusal the gateway will repeat, and
 * any other answer a failure that may be asked again.
 */
export function resentOf(response: Response): ResultAsync<void, DataError> {
  if (response.status === 202) {
    return okAsync(undefined)
  }

  if (response.status === 429) {
    return errAsync(
      dataError('data:RATE_LIMITED', 'the gateway asks to wait before the mail is sent again'),
    )
  }

  return errAsync(
    response.status >= 400 && response.status < 500
      ? dataError('data:WRITE_REJECTED', `the gateway refused the resend (${response.status})`)
      : dataError(
          'data:WRITE_FAILED',
          `the gateway could not send the mail again (${response.status})`,
        ),
  )
}
