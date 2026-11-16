import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { readBody } from '../../read-body'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import { accountOf, actionDone, isOwnAccount } from './account-action'
import type { Handler } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/**
 * The longest reason a ban is given, once trimmed: the card's input takes no more, so a longer one
 * comes only from a request made by hand, and is refused rather than kept.
 */
const MAX_BAN_REASON = 500

/** What an operator sends to ban an account: why, for operators alone, or nothing. */
const banBody = z.object({ reason: z.string().trim().max(MAX_BAN_REASON).optional() })

/**
 * The console's actions on an account's standing, each for an operator, on the account the path's
 * id names (an id of another form names none: 404 `account-gone`), each in that account's turn
 * (`turns`, by its identity's key), where the account is read again: one removed meanwhile answers
 * `account-gone`, and two operators' actions on one account run one after the other. The sockets
 * of the account close only once what ended its sessions committed, still in its turn, so a lift
 * of the ban that follows cannot be overtaken by the ban's close.
 *
 * - ban: the account banned with the body's reason (`{ reason? }`, at most 500 characters once
 *   trimmed) and every session of it ended `banned` in one transaction (`AccountBans.ban`), then
 *   its sockets closed with 4004.
 * - unban: the ban and its reason lifted (`AccountBans.unban`); nothing ends, nothing closes.
 * - sign-out: every session of the account ended `revoked`, as its own sign-out everywhere ends
 *   them (`AuthSessions.revokeAll`), then its sockets closed with 4001.
 *
 * A ban and a sign-out of the operator's own account are refused 409 `own-account` before its turn
 * is asked for and before anything is written (its own devices page signs it out everywhere). Each
 * action answers 204 once done.
 */
export function banHandlers(options: ConsoleRoutesOptions) {
  const failed = errorAnswer(options.onFailure)

  const ban =
    (id: string): Handler =>
    async (operator, request) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      const body = banBody.safeParse(await readBody(request))

      if (!body.success) {
        return refusalAnswer('bad-request')
      }

      if (isOwnAccount(operator, identity)) {
        return refusalAnswer('own-account')
      }

      return options.turns.run(identity, async () => {
        const banned = await options.bans.ban(identity, body.data.reason)

        if (banned.isErr()) {
          return failed(banned.error)
        }

        if (banned.value === 'gone') {
          return refusalAnswer('account-gone')
        }

        await options.connections.close(identity, undefined, CLOSE.banned)

        return actionDone()
      })
    }

  const unban =
    (id: string): Handler =>
    async () => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      return options.turns.run(identity, async () =>
        (await options.bans.unban(identity)).match(
          (outcome) => (outcome === 'gone' ? refusalAnswer('account-gone') : actionDone()),
          failed,
        ),
      )
    }

  const signOut =
    (id: string): Handler =>
    async (operator) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      if (isOwnAccount(operator, identity)) {
        return refusalAnswer('own-account')
      }

      return options.turns.run(identity, async () => {
        const account = await options.accounts.read(identity)

        if (account.isErr()) {
          return failed(account.error)
        }

        if (account.value === undefined) {
          return refusalAnswer('account-gone')
        }

        const revoked = await options.sessions.revokeAll(identity)

        if (revoked.isErr()) {
          return failed(revoked.error)
        }

        await options.connections.close(identity, undefined, CLOSE.revoked)

        return actionDone()
      })
    }

  return { ban, unban, signOut }
}
