/**
 * Builds the application router from the module manifests. Each module route
 * becomes a page inside its module's scope; `authenticated` pages send visitors
 * to sign-in, `guest` pages send a signed-in user to the profile, and `/` opens
 * whichever applies. After its guard, a page opens only for a device that holds one of its
 * `roles` (`admits`, the roles read by `heldBy`); any other device gets the not-found page (the
 * page of the module route at `/$`) in its place, at the same address, its search never read.
 * A lazy page's code (`LazyPage`) loads once its route admits the device, never before, the frame
 * shown meanwhile with the page's place empty.
 * A page left open when the account changes is checked again: a
 * protected one sends a visitor who signed out (here or in another tab) to sign-in, a
 * guest one sends a user another tab signed in to the profile. A sign-in of this tab's
 * own leaves a page that signs in (the sign-in page, a verification link's) to its flow (its
 * welcome); any other page open meanwhile is checked at once. It is
 * checked again as well when the roles the device holds change (the platform roles read anew,
 * another organisation or another role in it): it opens, or turns into the not-found page, where
 * it is. A route's `search` schema validates the URL's search, for a device the page serves (a
 * refused one lands in the error component); a parameter equal to its default leaves the URL, and
 * the `retain` parameters are carried across navigations.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  type RouterHistory,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from '@tanstack/react-router'
import type { FunctionComponent } from 'react'

import { admits } from '@workspace/ui-contract/anchors'
import { z } from '@workspace/zod'

import { heldBy } from './held-roles'
import { lazyComponent } from './lazy-page'
import { type ModuleDef, ModuleScope, type RouteDef } from './module'
import { type PageCrash, pageCrash } from './page-crash'
import { NOT_FOUND_PATH, resolvedRoute } from './resolved-route'
import type { SessionPort } from './session.port'

export const SIGN_IN_PATH = '/sign-in'

export const HOME_PATH = '/me'

/**
 * The pages whose own flow signs this tab in, the sign-in page and the one a verification link
 * opens: each moves on by itself once its sign-in went through, after its welcome.
 */
const SIGNING_IN_PAGES: ReadonlySet<string> = new Set([SIGN_IN_PATH, '/verify-email'])

/**
 * What of the session the router reads: who is signed in, whether this tab signs one in itself
 * (`SessionPort.signingInHere`), and the roles the device holds by the organisation current and
 * the account's platform roles, each with the listener that hears it change.
 */
export type RouterSession = Pick<
  SessionPort,
  | 'current'
  | 'subscribe'
  | 'signingInHere'
  | 'currentTenant'
  | 'subscribeMemberships'
  | 'roles'
  | 'onRoles'
>

export interface AppRouterOptions {
  readonly modules: readonly ModuleDef[]
  readonly session: RouterSession
  readonly layout: FunctionComponent
  readonly history?: RouterHistory
  /**
   * Put in the place of a page that failed to render, its search refused included, inside the
   * layout, which stays; its `reset` renders the page again, loading the page's route again when
   * its load failed, such as a lazy page's code that did not arrive (`pageCrash`).
   */
  readonly crash?: PageCrash
}

/** A page that resolves services from its own module before the application's. */
function inScope(module: ModuleDef, Page: FunctionComponent | undefined): FunctionComponent {
  return function ScopedPage() {
    return <ModuleScope module={module}>{Page ? <Page /> : null}</ModuleScope>
  }
}

/** What a lazy page's place shows while its code loads: nothing, the frame around it staying. */
const NOTHING_YET: FunctionComponent = () => null

/**
 * The route options of a module's page: its component, and for a lazy page the load of its code,
 * which the router runs once the route admits the device and before it renders the page. Until
 * the code is in, the frame shows at once with the page's place empty: without a pending page the
 * router shows nothing, the frame included, where the page opens afresh.
 */
function pageOptions(
  module: ModuleDef,
  route: RouteDef,
): {
  readonly component: FunctionComponent
  readonly pendingComponent?: FunctionComponent
  readonly pendingMs?: number
  readonly pendingMinMs?: number
} {
  const declared = module.declarations[route.page]

  if (declared !== undefined && typeof declared !== 'function') {
    const Page = lazyComponent(declared)

    return {
      component: Object.assign(inScope(module, Page), { preload: Page.preload }),
      pendingComponent: NOTHING_YET,
      pendingMs: 0,
      pendingMinMs: 0,
    }
  }

  return { component: inScope(module, declared) }
}

/** The page of the module route at `/$`, which a page shows in its place for a device it refuses. */
function notFoundPage(modules: readonly ModuleDef[]): FunctionComponent | undefined {
  for (const module of modules) {
    const route = module.routes.find(({ path }) => path === NOT_FOUND_PATH)

    if (route !== undefined) {
      return pageOptions(module, route).component
    }
  }

  return undefined
}

/** The search a route's schema yields: its parameters by name. */
type Search = z.output<z.ZodObject<z.ZodRawShape>>

/** The parameters of a search schema that have a default, with that default. */
function defaultsOf(search: z.ZodObject<z.ZodRawShape>): Partial<Search> {
  return Object.fromEntries(
    Object.entries(search.shape).flatMap(([name, schema]) => {
      const empty = z.safeParse(schema, undefined)

      return empty.success && empty.data !== undefined ? [[name, empty.data]] : []
    }),
  )
}

/**
 * The `createRoute` options that validate a route's search and keep its URL short. The router
 * reads the search while it matches the address, before the page's `beforeLoad`: for a device the
 * page refuses (`refused`) it is left as it came, unread, so `beforeLoad` answers not-found rather
 * than the search's error.
 */
function searchOptions(route: RouteDef, refused: () => boolean) {
  const schema = route.search

  if (!schema) {
    return {}
  }

  return {
    validateSearch: (raw: Record<string, unknown>): Search =>
      refused() ? raw : z.parse(schema, raw),
    search: {
      middlewares: [
        stripSearchParams<Search>(defaultsOf(schema)),
        retainSearchParams<Search>([...(route.retain ?? [])]),
      ],
    },
  }
}

/** Every module of the application with the modules it imports, imports first. */
export function allModules(modules: readonly ModuleDef[]): ModuleDef[] {
  return modules.flatMap((module) => [...allModules(module.imports), module])
}

export function createAppRouter(options: AppRouterOptions) {
  const signedIn = (): boolean => options.session.current() !== undefined
  const refuses = (route: RouteDef) => () => !admits(route.roles, heldBy(options.session))
  // The guard first, then the roles: a guard sends away only a device the page's roles refuse.
  const admission = (route: RouteDef) => () => {
    if (route.guard === 'authenticated' && !signedIn()) {
      throw redirect({ to: SIGN_IN_PATH })
    }

    if (route.guard === 'guest' && signedIn()) {
      throw redirect({ to: HOME_PATH })
    }

    if (refuses(route)()) {
      throw notFound()
    }
  }
  const modules = allModules(options.modules)
  const lost = notFoundPage(modules)
  const crash = options.crash ? pageCrash(options.crash) : undefined
  const root = createRootRoute({ component: options.layout })
  const start = createRoute({
    getParentRoute: () => root,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: signedIn() ? HOME_PATH : SIGN_IN_PATH })
    },
  })
  const pages = modules.flatMap((module) =>
    module.routes.map((route) =>
      createRoute({
        getParentRoute: () => root,
        path: route.path,
        ...pageOptions(module, route),
        beforeLoad: admission(route),
        ...(lost ? { notFoundComponent: lost } : {}),
        ...(crash ? { errorComponent: crash } : {}),
        ...searchOptions(route, refuses(route)),
      }),
    ),
  )

  const router = createRouter({
    routeTree: root.addChildren([start, ...pages]),
    ...(options.history ? { history: options.history } : {}),
  })
  // The roles the device held when the open page was last checked.
  const heldNow = () => [...heldBy(options.session)].sort().join(' ')
  let held = heldNow()

  // Whether the open page is left to its flow: one of the pages that sign in, while this tab signs
  // an account in itself. Any other page open meanwhile has no flow to follow it.
  const leftToItsFlow = () => {
    const open = resolvedRoute(router.state)

    return open !== undefined && SIGNING_IN_PAGES.has(open) && options.session.signingInHere()
  }

  // The router lives as long as the page, so it never stops listening. Every change of the account
  // checks the open page again, but the appearance of one this tab is signing in itself on a page
  // that signs in: that page moves on by its flow, after its welcome.
  options.session.subscribe((user) => {
    held = heldNow()

    if (user === undefined || !leftToItsFlow()) {
      void router.invalidate()
    }
  })

  // So does every change of the roles the device holds, but one read while such a page signs an
  // account in, which its flow follows as well.
  const recheck = () => {
    const now = heldNow()

    if (now === held) {
      return
    }

    held = now

    if (!leftToItsFlow()) {
      void router.invalidate()
    }
  }

  options.session.onRoles(recheck)
  options.session.subscribeMemberships(recheck)

  return router
}
