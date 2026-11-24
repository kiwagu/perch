import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'

import { tooMany } from '../limits/too-many'

/**
 * The codes a console route refuses a request with, besides a missing session (401
 * `unauthorized`, the Bearer caller's own answer) and a method a path does not take (405).
 */
export type ConsoleRefusalCode =
  | 'bad-request'
  | 'name-required'
  | 'name-too-long'
  | 'email-invalid'
  | 'not-operator'
  | 'account-gone'
  | 'own-account'
  | 'last-admin'
  | 'email-taken'
  | 'verified-before'
  | 'failed'
  | 'rate-limited'

/**
 * The codes a refusal is answered with by its status alone: a mail past its allowance also says
 * when to ask again (`rateLimited`).
 */
export type PlainRefusalCode = Exclude<ConsoleRefusalCode, 'rate-limited'>

/** A console request refused for what was asked, not for a failure of the gateway. */
export interface ConsoleRefusal {
  readonly kind: 'refused'
  readonly code: PlainRefusalCode
}

/** Why a console request was not done: a refusal, or a failure of the gateway. */
export type ConsoleError = ConsoleRefusal | DataError

export function refused(code: PlainRefusalCode): ConsoleRefusal {
  return { kind: 'refused', code }
}

/**
 * The HTTP status a console route answers a refusal with, as the organisation routes answer the
 * same kinds (`tenants/organisation-refusal.ts`): what was asked does not follow its schema or its
 * rules 400 (a name empty or too long, a text that is no email), an account that is no operator
 * 403, an account no longer there 404, an action the account's state refuses 409 (one on the
 * operator's own account, as an admin's on itself, `self`; the only admin of an organisation with
 * other members; an email an account holds; an email verified before; a name with no profile to
 * carry it), a mail past its allowance 429.
 */
export function refusalStatus(code: ConsoleRefusalCode): number {
  return match(code)
    .with('bad-request', 'name-required', 'name-too-long', 'email-invalid', () => 400)
    .with('not-operator', () => 403)
    .with('account-gone', () => 404)
    .with('own-account', 'last-admin', 'email-taken', 'verified-before', 'failed', () => 409)
    .with('rate-limited', () => 429)
    .exhaustive()
}

/** The answer to a refusal: its code, with its status. */
export function refusalAnswer(code: PlainRefusalCode): Response {
  return Response.json({ code }, { status: refusalStatus(code) })
}

/**
 * The answer to a mail past its allowance: 429 `rate-limited` with `Retry-After` in whole seconds,
 * as every limit of the gateway answers (`tooMany`).
 */
export function rateLimited(allowance: { readonly retryAfterMs: number }): Response {
  return tooMany(allowance)
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
