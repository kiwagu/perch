/**
 * What a test of the gateway's auth needs to hold a refused or failed request to keep nothing it
 * sent: markers a request may carry, a fetch that rejects with them, and the checks.
 */

import { expect } from 'vitest'

import type { DataError } from '@workspace/data'

/** Whether `error` says nothing of `secrets`, in its message or anywhere else it carries. */
export function namesNone(error: DataError, ...secrets: string[]): void {
  for (const secret of secrets) {
    expect(error.message).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
  }
}

/** Markers a failed request may carry back in its rejection: the link's token, an email, a password. */
export const TOKEN_MARKER = 'token-marker-7f3a'
export const EMAIL_MARKER = 'marker-7f3a@example.test'
export const PASSWORD_MARKER = 'password-marker-7f3a'

/**
 * A fetch that rejects with what its request carried, in the rejection's message and in its own
 * properties, as a failing fetch may.
 */
export const rejectsCarrying = () => () =>
  Promise.reject(
    Object.assign(
      new TypeError(`Failed to fetch ${TOKEN_MARKER} for ${EMAIL_MARKER} with ${PASSWORD_MARKER}`),
      {
        request: {
          body: JSON.stringify({
            token: TOKEN_MARKER,
            email: EMAIL_MARKER,
            password: PASSWORD_MARKER,
          }),
        },
        sent: [TOKEN_MARKER, EMAIL_MARKER, PASSWORD_MARKER],
      },
    ),
  )

/** Whether `error` keeps no cause and names no marker, in its message or anywhere else. */
export function keepsNothingOfTheRejection(error: DataError): void {
  expect(error.code).toBe('data:OFFLINE')
  expect(error.cause).toBeUndefined()
  expect(Object.keys(error)).not.toContain('cause')
  namesNone(error, TOKEN_MARKER, EMAIL_MARKER, PASSWORD_MARKER)
}
