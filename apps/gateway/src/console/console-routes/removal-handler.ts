import { ResultAsync } from 'neverthrow'

import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import type { DeletedAccount } from '../../auth/account-teardown'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import { accountOf, actionDone, inAccountTurn, isOwnAccount } from './account-action'
import type { Handler } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/**
 * The console's removal of an account, for an operator: the account's own deletion, without the
 * mailed link (`deleteAccount` in the auth mount). The operator's own account is refused 409
 * `own-account` before its turn is asked for and before anything is read; an id of another form
 * names no account (404 `account-gone`). In the account's turn (`inAccountTurn`), where the account
 * is read again (one removed meanwhile answers `account-gone`), it leaves its organisations in
 * their turns (`Organisations.leaveAll`, through `departure`), whose check decides: the only admin
 * of an organisation with other members answers 409 `last-admin` with nothing changed. Only once
 * the departure is allowed, and before it writes anything, whom the notice goes to is read while
 * the account exists, every session of the account ends and every socket of it closes with 4001;
 * then it leaves its organisations (one it alone belongs to goes with it) and its own rows are
 * removed, and its sockets close with 4001 once more, as a device may have signed in meanwhile.
 * Once it is gone the notice starts to the email it had, in its language, and it answers 204. A
 * removal that failed part way (500 `internal`) is completed by asking for it again: what was done
 * stays done, and the rest runs.
 */
export function removalHandler(options: ConsoleRoutesOptions) {
  const failed = errorAnswer(options.onFailure)

  /**
   * Closes every socket of `identity` with 4001 and moves the registry's epoch against it, so a
   * hello that read the epoch before is refused at its registration. The registry's closes never
   * reject.
   */
  const closed = (identity: IdentityId): ResultAsync<void, never> =>
    ResultAsync.fromSafePromise(options.connections.close(identity, undefined, CLOSE.revoked))

  return (id: string): Handler =>
    async (operator) => {
      const identity = accountOf(id)

      if (identity === undefined) {
        return refusalAnswer('account-gone')
      }

      if (isOwnAccount(operator, identity)) {
        return refusalAnswer('own-account')
      }

      return inAccountTurn(options, identity, async () => {
        const left = await options.departure.leave<DeletedAccount, never>(identity, {
          before: () =>
            options.teardown
              .addressee(identity)
              .andThen((addressee) => options.sessions.revokeAll(identity).map(() => addressee))
              .andThen((addressee) => closed(identity).map(() => addressee)),
          after: () => options.teardown.remove(identity).andThen(() => closed(identity)),
        })

        if (left.isErr()) {
          return 'kind' in left.error ? refusalAnswer('last-admin') : failed(left.error)
        }

        options.mails.accountDeleted(left.value)

        return actionDone()
      })
    }
}
