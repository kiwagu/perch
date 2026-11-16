import { type IdentityId, idSchemas } from '@workspace/ids'

import type { AccountCard } from '../account-directory'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import type { Operator } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/** The answer to an action done: nothing more to say, the card reads the account again. */
export const actionDone = (): Response => new Response(null, { status: 204 })

/** The account a path's id names, or `undefined` for an id of another form, which names none. */
export function accountOf(id: string): IdentityId | undefined {
  const identity = idSchemas.identity.schema.safeParse(id)

  return identity.success ? identity.data : undefined
}

/** Whether `identity` is the operator's own account, which a ban, a sign-out and a removal refuse. */
export const isOwnAccount = (operator: Operator, identity: IdentityId): boolean =>
  operator.identity === identity

/**
 * Runs `work` on the account of `identity` in its turn (`turns`, by its identity's key), once the
 * work asked of the account before it is done: the account is read there, so one removed
 * meanwhile answers 404 `account-gone`, and `work` gets it as it is in that turn. A read that
 * fails answers 500 `internal`, which `onFailure` hears.
 */
export function inAccountTurn(
  options: Pick<ConsoleRoutesOptions, 'turns' | 'accounts' | 'onFailure'>,
  identity: IdentityId,
  work: (account: AccountCard) => Promise<Response>,
): Promise<Response> {
  const failed = errorAnswer(options.onFailure)

  return options.turns.run(identity, async () => {
    const account = await options.accounts.read(identity)

    if (account.isErr()) {
      return failed(account.error)
    }

    return account.value === undefined ? refusalAnswer('account-gone') : work(account.value)
  })
}
