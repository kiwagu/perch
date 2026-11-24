import { matchPath } from '../../route-path'

/** What an operator does to one account, each at its own path under the account's. */
export const ACCOUNT_ACTIONS = [
  'rename',
  'email',
  'ban',
  'unban',
  'sign-out',
  'reset',
  'verification',
  'removal',
] as const

export type AccountAction = (typeof ACCOUNT_ACTIONS)[number]

/**
 * What a console path names: the platform's accounts, one of them by its identity id, or an
 * action on one of them.
 */
export type Target =
  | { readonly kind: 'accounts' }
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'action'; readonly id: string; readonly action: AccountAction }

/**
 * The path each kind of target is served under, an account's identity id written `:id` and an
 * action `:action`, one of `ACCOUNT_ACTIONS`: `targetOf` answers a path only through these. An
 * empty segment (`/console/accounts/`), an action the console does not take and a longer path are
 * not the console's.
 */
const PATH_OF = {
  accounts: '/console/accounts',
  account: '/console/accounts/:id',
  action: '/console/accounts/:id/:action',
} as const satisfies Readonly<Record<Target['kind'], string>>

/** The paths the console answers, each action of `ACCOUNT_ACTIONS` at its own. */
export const CONSOLE_PATHS: readonly string[] = [
  PATH_OF.accounts,
  PATH_OF.account,
  ...ACCOUNT_ACTIONS.map((action) => PATH_OF.action.replace(':action', action)),
]

const isAction = (segment: string): segment is AccountAction =>
  ACCOUNT_ACTIONS.some((action) => action === segment)

/** What `pathname` names, or `undefined` for a path that is not the console's. */
export function targetOf(pathname: string): Target | undefined {
  if (matchPath(PATH_OF.accounts, pathname)) {
    return { kind: 'accounts' }
  }

  const account = matchPath(PATH_OF.account, pathname)

  if (account) {
    return { kind: 'account', id: account.id }
  }

  const action = matchPath(PATH_OF.action, pathname)

  return action && isAction(action.action)
    ? { kind: 'action', id: action.id, action: action.action }
    : undefined
}
