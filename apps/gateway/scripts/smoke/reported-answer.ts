import { z } from '@workspace/zod'

/**
 * The codes a step may print: the gateway's own refusals, and those of Better Auth's that the
 * gateway passes on. Any other code is reported as unlisted: a code is the one part of a body a
 * step prints, so it must be one known to name a refusal and nothing that was sent.
 */
const REPORTED_CODES: ReadonlySet<string> = new Set([
  // The gateway's.
  'already-member',
  'bad-request',
  'email-invalid',
  'forbidden-region',
  'internal',
  'invalid-key',
  'invalid-name',
  'invitation-gone',
  'key-taken',
  'last-admin',
  'link-expired',
  'link-invalid',
  'method-not-allowed',
  'no-such-device',
  'no-such-identity',
  'no-such-member',
  'no-such-tenant',
  'not-a-member',
  'not-admin',
  'not-found',
  'other-account',
  'rate-limited',
  'self',
  'unauthorized',
  'weak-password',
  // Better Auth's, passed on by the auth mount.
  'EMAIL_NOT_VERIFIED',
  'FAILED_TO_CREATE_SESSION',
  'FAILED_TO_CREATE_USER',
  'INVALID_EMAIL',
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_SHORT',
  'VALIDATION_ERROR',
])

const coded = z.object({ code: z.string() })

/**
 * An answer a step did not expect, as the step reports it: its status, and its code when that is
 * one of `REPORTED_CODES`. Never its body: an answer a regression let through can carry a session
 * token, an account's email or a link, and the step's failure is printed.
 */
export function reported(answer: { readonly status: number; readonly body: unknown }): string {
  if (answer.body === undefined) {
    return `${answer.status} with no body`
  }

  const body = coded.safeParse(answer.body)

  if (!body.success) {
    return `${answer.status} with a body that names no code`
  }

  return REPORTED_CODES.has(body.data.code)
    ? `${answer.status} ${body.data.code}`
    : `${answer.status} with an unlisted code`
}
