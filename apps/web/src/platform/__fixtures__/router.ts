/**
 * The application's router for the specs that hold it to the UI contract: built on a memory
 * history with nobody signed in, never rendered, and read back the way a reload reads a URL.
 */

import { createMemoryHistory } from '@tanstack/react-router'

import type { ModuleDef } from '../module'
import { createAppRouter } from '../router'

/** The router's name for the value of a splat. */
export const SPLAT = '_splat'

/** The router reports a splat's value under `_splat` and again under `*`, its older name. */
const SPLAT_ALIAS = '*'

/** A router of `of` on a memory history, with nobody signed in; nothing renders it. */
export function routerOf(of: readonly ModuleDef[]) {
  return createAppRouter({
    modules: of,
    session: { current: () => undefined, subscribe: () => () => {} },
    layout: () => null,
    history: createMemoryHistory({ initialEntries: ['/'] }),
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
