/** What a console path names: the platform's accounts, or one of them by its identity id. */
export type Target =
  | { readonly kind: 'accounts' }
  | { readonly kind: 'account'; readonly id: string }

/**
 * The console's paths: `/console/accounts` and `/console/accounts/:id`. An empty last segment
 * (`/console/accounts/`) and a longer path are not the console's.
 */
const PATH = /^\/console\/accounts(?:\/([^/]+))?$/

/** What `pathname` names, or `undefined` for a path that is not the console's. */
export function targetOf(pathname: string): Target | undefined {
  const found = PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, id] = found

  return id === undefined ? { kind: 'accounts' } : { kind: 'account', id }
}
