import { ResultAsync } from 'neverthrow'

import { dataError } from '@workspace/data'

import { FRONT_PREFIX } from '../../config'
import { errorAnswer, rateLimited, refusalAnswer } from '../console-refusal'

import { accountOf, actionDone, inAccountTurn } from './account-action'
import type { Handler } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/** Better Auth's resend of the verification mail, at the path it serves it under. */
const RESEND_PATH = `${FRONT_PREFIX}/auth/send-verification-email`

/**
 * The request that asks Better Auth to send `email` its verification mail again, at its path on
 * the gateway that `request` reached: the email alone, with no header of the operator's request,
 * so Better Auth sees no session and runs its path for a visitor, as the auth mount's resend asks
 * it.
 */
function resendRequest(request: Request, email: string): Request {
  return new Request(new URL(RESEND_PATH, request.url).href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: request.signal,
  })
}

/**
 * The console's mails to an account, each for an operator, on the account the path's id names
 * (an id of another form names none: 404 `account-gone`), each in that account's turn
 * (`inAccountTurn`), where the account is read again: one removed meanwhile answers
 * `account-gone`. Each is the mail the account could ask for itself, under its own allowances and
 * one of the operator's address's mails, and answers 204 once it is on its way.
 *
 * - reset: in the account's turn, one of the reset mails of the email the account has there is
 *   taken (`RequestLimits.resetMail`, 429 `rate-limited`, nothing asked), so the email that pays
 *   is the one the mail goes to: a change of the email confirmed meanwhile takes the same turn,
 *   and lands wholly before this read or after the mail. Then, in that email's turn, as the
 *   account's own request takes it, Better Auth keeps a new link, the account's earlier ones
 *   ending, and the mail starts in the account's language (`AccountPasswords.requestReset`).
 * - verification: an account whose email is verified answers 409 `verified-before`, nothing
 *   sent; otherwise one of the email's verification mails is taken
 *   (`RequestLimits.verificationMail`, 429 `rate-limited`) and Better Auth is asked to send the
 *   mail again with the email alone, as a visitor asks it (`resendRequest`). No turn of the email
 *   is taken: a verification of the email, which takes that turn alone, can verify the account
 *   after the account was read unverified and before the resend, which then mails nothing while
 *   this still answers 204, a residue accepted.
 */
export function mailHandlers(options: ConsoleRoutesOptions) {
  const failed = errorAnswer(options.onFailure)

  const sendReset =
    (id: string): Handler =>
    async (_operator, _request, from) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      return inAccountTurn(options, identity, async ({ email }) => {
        const mails = options.limits.resetMail(from, email)

        if (!mails.allowed) {
          return rateLimited(mails)
        }

        const asked = await options.turns.run(email, () => options.passwords.requestReset(email))

        if (asked.isErr()) {
          return failed(asked.error)
        }

        return asked.value === 'asked'
          ? actionDone()
          : failed(dataError('data:WRITE_REJECTED', 'the reset mail of an account was refused'))
      })
    }

  const resendVerification =
    (id: string): Handler =>
    async (_operator, request, from) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      return inAccountTurn(options, identity, async ({ email, emailVerified }) => {
        if (emailVerified) {
          return refusalAnswer('verified-before')
        }

        const mails = options.limits.verificationMail(from, email)

        if (!mails.allowed) {
          return rateLimited(mails)
        }

        const answer = await ResultAsync.fromPromise(
          options.auth.handler(resendRequest(request, email)),
          () => dataError('data:WRITE_FAILED', 'the verification mail could not be asked for'),
        )

        if (answer.isErr()) {
          return failed(answer.error)
        }

        return answer.value.status === 200
          ? actionDone()
          : failed(
              dataError(
                'data:WRITE_FAILED',
                `the verification mail was answered ${answer.value.status}`,
              ),
            )
      })
    }

  return { sendReset, resendVerification }
}
