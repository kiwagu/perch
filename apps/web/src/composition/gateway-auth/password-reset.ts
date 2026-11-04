/**
 * What setting a new password with a reset link's token answers: set, or why not. The request
 * carries a password and a token, so an error names the status alone, never either.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { z } from '@workspace/zod'

import { answerBody, linkRefusedBy, refusalCode } from './answer-body'

/** A password set: whether the session the device presented was one of those the reset ended. */
export interface PasswordReset {
  readonly signedOut: boolean
}

const reset = z.object({ signedOut: z.boolean() })

/**
 * Set (200, saying whether the device's own session ended with the others); a password that breaks
 * the rules (400 `password-rejected`), the link kept; a link past its hour (401 `link-expired`) or
 * one that does not work (any other 401); a request to wait (429); any other answer fails naming
 * its status. A 200 that does not say it fails too, though the password is set: without it this
 * device cannot tell whether it is still signed in.
 */
export function passwordResetOf(response: Response): ResultAsync<PasswordReset, DataError> {
  if (response.status === 200) {
    return answerBody(response).andThen((body) => {
      const parsed = reset.safeParse(body)

      return parsed.success
        ? okAsync(parsed.data)
        : errAsync(
            dataError(
              'data:AUTH_FAILED',
              'the gateway answered the reset with something other than its outcome',
            ),
          )
    })
  }

  if (response.status === 401) {
    return linkRefusedBy(response).andThen((refused) => errAsync<PasswordReset, DataError>(refused))
  }

  if (response.status === 400) {
    return refusalCode(response).andThen((code) =>
      errAsync<PasswordReset, DataError>(
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
