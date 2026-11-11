/** What an operator does to one account, each at its own path under the account's. */
export const ACCOUNT_ACTIONS = ['ban', 'unban', 'sign-out'] as const

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
 * The console's paths: `/console/accounts`, `/console/accounts/:id` and
 * `/console/accounts/:id/:action`. An empty segment (`/console/accounts/`), an action the console
 * does not take and a longer path are not the console's.
 */
const PATH = /^\/console\/accounts(?:\/([^/]+)(?:\/([^/]+))?)?$/

const isAction = (segment: string): segment is AccountAction =>
  ACCOUNT_ACTIONS.some((action) => action === segment)

/** What `pathname` names, or `undefined` for a path that is not the console's. */
export function targetOf(pathname: string): Target | undefined {
  const found = PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, id, action] = found

  if (id === undefined) {
    return { kind: 'accounts' }
  }

  if (action === undefined) {
    return { kind: 'account', id }
  }

  return isAction(action) ? { kind: 'action', id, action } : undefined
}
