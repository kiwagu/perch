/**
 * The application's router for the specs that hold it to the UI contract: built on a memory
 * history over a session that holds a set of roles and never changes, never rendered, and read
 * back the way a reload reads a URL: matched only, or loaded, its guards and roles run.
 */

import { createMemoryHistory } from '@tanstack/react-router'

import type { AuthUser } from '@workspace/data'
import { PLATFORM_ROLES, type PlatformRole, TENANT_ROLES, type TenantRole } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'
import { GUEST } from '@workspace/ui-contract/anchors'

import type { ModuleDef } from '../module'
import { createAppRouter, type RouterSession } from '../router'

/** The router's name for the value of a splat. */
export const SPLAT = '_splat'

/** The router reports a splat's value under `_splat` and again under `*`, its older name. */
const SPLAT_ALIAS = '*'

/** The account a session signs in when its roles name more than `guest`. */
const ANN: AuthUser = {
  id: 'idn_0000000000000000.01m52pexcp' as AuthUser['id'],
  email: 'ann@example.test',
}

const isTenantRole = (role: string): role is TenantRole =>
  TENANT_ROLES.some((tenant) => tenant === role)

const isPlatformRole = (role: string): role is PlatformRole =>
  PLATFORM_ROLES.some((platform) => platform === role)

/**
 * A session that holds `roles` and never changes: nobody signed in for `guest`; Ann signed in
 * otherwise, `member` or `admin` her role in the organisation current, `operator` a platform
 * role of her account.
 */
export function holding(roles: readonly string[]): RouterSession {
  const signedIn = roles.some((role) => role !== GUEST)
  const tenant = roles.find(isTenantRole)
  const membership: Membership | undefined =
    tenant === undefined
      ? undefined
      : { tenant: { id: 'tnt_acme', key: 'acme', name: 'Acme' }, role: tenant }
  const platform: ReadonlySet<PlatformRole> = new Set(roles.filter(isPlatformRole))

  return {
    current: () => (signedIn ? ANN : undefined),
    subscribe: () => () => {},
    signingInHere: () => false,
    currentTenant: () => membership,
    subscribeMemberships: () => () => {},
    roles: () => platform,
    onRoles: () => () => {},
  }
}

/**
 * A router of `of` on a memory history at `path`, over a session holding `roles` (a guest's by
 * default); nothing renders it.
 */
export function routerOf(of: readonly ModuleDef[], roles: readonly string[] = [GUEST], path = '/') {
  return createAppRouter({
    modules: of,
    session: holding(roles),
    layout: () => null,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

export type AppRouter = ReturnType<typeof routerOf>

/** The parameters of a match, without the splat's older name when it repeats `_splat`. */
function paramsOf(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { [SPLAT_ALIAS]: alias, ...named } = params

  return alias === named[SPLAT] ? named : { ...params }
}

/**
 * The fields of a route match the specs read: the router types them `any`, its route tree
 * being built at runtime.
 */
interface Match {
  readonly fullPath: string
  readonly params: Readonly<Record<string, unknown>>
  readonly search: Readonly<Record<string, unknown>>
  readonly searchError: unknown
}

/** What the router matches for a URL's path and search. */
export interface Matched {
  /** The full path of the deepest route the URL matches. */
  readonly fullPath: string | undefined
  readonly params: Record<string, unknown>
  readonly search: Record<string, unknown>
  /** Why the route refused the search, if it did. */
  readonly searchError?: unknown
}

/**
 * The deepest route the router matches for `pathname` and `searchStr`, the search read from
 * the text the way a reload reads it. A refused search is reported, not thrown.
 */
export function matchAt(router: AppRouter, pathname: string, searchStr: string): Matched {
  const match: Match | undefined = router
    .matchRoutes(pathname, router.options.parseSearch(searchStr))
    .at(-1)

  return {
    fullPath: match?.fullPath,
    params: paramsOf(match?.params ?? {}),
    search: { ...match?.search },
    searchError: match?.searchError,
  }
}
