import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { readBody } from '../../read-body'
import { errorAnswer, rateLimited, refusalAnswer } from '../console-refusal'

import { accountOf, actionDone, inAccountTurn } from './account-action'
import type { Handler } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/** The longest name a profile takes, as the account's own profile page holds it. */
const MAX_NAME = 80

/** The longest email an account takes, as the account's own change of its email holds it. */
const MAX_EMAIL = 320

/** What an operator sends to rename an account: the name, held to its rule below. */
const renameBody = z.object({ name: z.string() })

/** The name a profile takes: 1 to 80 characters once trimmed, as on the profile page. */
const profileName = z.string().trim().min(1).max(MAX_NAME)

/** What an operator sends to change an account's email: the new email, held to its shape below. */
const emailBody = z.object({ email: z.string() })

/** A new email as the account's own change takes it: lower case, trimmed, at most 320 characters. */
const newEmailShape = z.email().max(MAX_EMAIL)

/** Why a name breaks its rule: none left once trimmed, or longer than a profile takes. */
const nameRefusal = (name: string) =>
  name.trim().length === 0 ? ('name-required' as const) : ('name-too-long' as const)

/**
 * The console's changes of an account, each for an operator, on the account the path's id names
 * (an id of another form names none: 404 `account-gone`), each in that account's turn
 * (`inAccountTurn`), where the account is read again: one removed meanwhile answers
 * `account-gone`, and two operators' changes, or an operator's and the account's own, run one
 * after the other. Each answers 204 once done.
 *
 * - rename (`{ name }`): the name held to the profile page's rule (trimmed, 400 `name-required`
 *   when nothing is left, 400 `name-too-long` past 80 characters), then, in the account's turn,
 *   written into its profile through its private region (`ProfileNames.rename`), so its devices
 *   show it as any change of the profile; an account that has no profile yet (it never signed
 *   in) has no name to set: 409 `failed`, nothing written.
 * - email (`{ email }`): the account's own change of its email, without its password: a new
 *   email that is no email (in lower case and trimmed, at most 320 characters) answers 400
 *   `email-invalid` before anything is taken; then one of the operator's address's mails and one
 *   of the account's three changes in a quarter of an hour are taken
 *   (`RequestLimits.emailChangeMail`, 429 `rate-limited`); in the account's turn, the account's
 *   own email, or one another account holds, answers 409 `email-taken`, nothing changed and
 *   nothing sent; any other ends the account's pending change, keeps the new one and starts the
 *   mail to the new email with its link (`EmailChanges`, `AccountMails.confirmEmail`). The
 *   account keeps its email until the link is opened, which also marks the new one verified.
 */
export function editHandlers(options: ConsoleRoutesOptions) {
  const failed = errorAnswer(options.onFailure)

  const rename =
    (id: string): Handler =>
    async (_operator, request) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      const body = renameBody.safeParse(await readBody(request))

      if (!body.success) {
        return refusalAnswer('bad-request')
      }

      const name = profileName.safeParse(body.data.name)

      if (!name.success) {
        return refusalAnswer(nameRefusal(body.data.name))
      }

      return inAccountTurn(options, identity, async () =>
        (await options.names.rename(identity, name.data)).match(
          (renamed) => (renamed === 'renamed' ? actionDone() : refusalAnswer('failed')),
          failed,
        ),
      )
    }

  const changeEmail =
    (id: string): Handler =>
    async (_operator, request, from) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      const body = emailBody.safeParse(await readBody(request))

      if (!body.success) {
        return refusalAnswer('bad-request')
      }

      const newEmail = newEmailShape.safeParse(body.data.email.trim().toLowerCase())

      if (!newEmail.success) {
        return refusalAnswer('email-invalid')
      }

      const mails = options.limits.emailChangeMail(from, identity)

      if (!mails.allowed) {
        return rateLimited(mails)
      }

      return inAccountTurn(options, identity, async (account) =>
        (await keepChange(options, identity, account.email, newEmail.data)).match(
          (kept) => (kept ? actionDone() : refusalAnswer('email-taken')),
          failed,
        ),
      )
    }

  return { rename, changeEmail }
}

/**
 * In the account's turn: `false`, nothing changed, when `newEmail` is the account's own `email`
 * or another account's; otherwise the account's pending change of its email ends, a new one from
 * `email` to `newEmail` is kept, and the mail to `newEmail` with its link starts: `true`.
 */
function keepChange(
  options: ConsoleRoutesOptions,
  identity: IdentityId,
  email: string,
  newEmail: string,
): ResultAsync<boolean, DataError> {
  const taken: ResultAsync<boolean, DataError> =
    newEmail === email
      ? okAsync(true)
      : options.sessions.identityOf(newEmail).map((holder) => holder !== undefined)

  return taken.andThen((isTaken) =>
    isTaken
      ? okAsync(false)
      : options.emailChanges
          .cancel(identity)
          .andThen(() => options.emailChanges.ask(identity, email, newEmail))
          .map((token) => {
            options.mails.confirmEmail(identity, newEmail, token)

            return true
          }),
  )
}
