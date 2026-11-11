import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'

/**
 * The codes a console route refuses a request with, besides a missing session (401
 * `unauthorized`, the Bearer caller's own answer) and a method a path does not take (405).
 */
export type ConsoleRefusalCode = 'bad-request' | 'not-operator' | 'account-gone' | 'own-account'

/** A console request refused for what was asked, not for a failure of the gateway. */
export interface ConsoleRefusal {
  readonly kind: 'refused'
  readonly code: ConsoleRefusalCode
}

/** Why a console request was not done: a refusal, or a failure of the gateway. */
export type ConsoleError = ConsoleRefusal | DataError

export function refused(code: ConsoleRefusalCode): ConsoleRefusal {
  return { kind: 'refused', code }
}

/**
 * The HTTP status a console route answers a refusal with, as the organisation routes answer the
 * same kinds (`tenants/organisation-refusal.ts`): what was asked does not follow its schema 400, an
 * account that is no operator 403, an account no longer there 404, an action the operator may not
 * take on its own account 409, as an admin's on itself (`self`).
 */
export function refusalStatus(code: ConsoleRefusalCode): number {
  return match(code)
    .with('bad-request', () => 400)
    .with('not-operator', () => 403)
    .with('account-gone', () => 404)
    .with('own-account', () => 409)
    .exhaustive()
}

/** The answer to a refusal: its code, with its status. */
export function refusalAnswer(code: ConsoleRefusalCode): Response {
  return Response.json({ code }, { status: refusalStatus(code) })
}

/**
 * What a console route answers an error with: a refusal its code with its status; a failure of
 * the gateway 500 `internal` without its cause, which `onFailure` hears.
 */
export function errorAnswer(
  onFailure: (error: DataError) => void,
): (error: ConsoleError) => Response {
  return (error) => {
    if ('kind' in error) {
      return refusalAnswer(error.code)
    }

    onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }
}
