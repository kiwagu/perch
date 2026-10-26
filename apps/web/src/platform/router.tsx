/**
 * Builds the application router from the module manifests. Each module route
 * becomes a page inside its module's scope; `authenticated` pages send visitors
 * to sign-in, `guest` pages send a signed-in user to the profile, and `/` opens
 * whichever applies. A page left open when the user signs out (here or in another
 * tab) is checked again, so a protected one sends the visitor to sign-in.
 * A route's `search` schema validates the URL's search (a refused one lands in the
 * error component); a parameter equal to its default leaves the URL, and the
 * `retain` parameters are carried across navigations.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from '@tanstack/react-router'
import type { FunctionComponent } from 'react'

import type { AuthUser } from '@workspace/data'
import { z } from '@workspace/zod'

import { type ModuleDef, ModuleScope, type RouteDef } from './module'

export const SIGN_IN_PATH = '/sign-in'

export const HOME_PATH = '/me'

export interface AppRouterOptions {
  readonly modules: readonly ModuleDef[]
  readonly session: {
    current(): AuthUser | undefined
    subscribe(listener: (user: AuthUser | undefined) => void): () => void
  }
  readonly layout: FunctionComponent
  readonly history?: RouterHistory
}

/** A page that resolves services from its own module before the application's. */
function scopedPage(module: ModuleDef, route: RouteDef): FunctionComponent {
  const Page = module.declarations[route.page]

  return function ScopedPage() {
    return <ModuleScope module={module}>{Page ? <Page /> : null}</ModuleScope>
  }
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

/** The `createRoute` options that validate a route's search and keep its URL short. */
function searchOptions(route: RouteDef) {
  if (!route.search) {
    return {}
  }

  return {
    validateSearch: route.search,
    search: {
      middlewares: [
        stripSearchParams<Search>(defaultsOf(route.search)),
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
  const guard = (route: RouteDef) => () => {
    if (route.guard === 'authenticated' && !signedIn()) {
      throw redirect({ to: SIGN_IN_PATH })
    }

    if (route.guard === 'guest' && signedIn()) {
      throw redirect({ to: HOME_PATH })
    }
  }
  const root = createRootRoute({ component: options.layout })
  const start = createRoute({
    getParentRoute: () => root,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: signedIn() ? HOME_PATH : SIGN_IN_PATH })
    },
  })
  const pages = allModules(options.modules).flatMap((module) =>
    module.routes.map((route) =>
      createRoute({
        getParentRoute: () => root,
        path: route.path,
        component: scopedPage(module, route),
        beforeLoad: guard(route),
        ...searchOptions(route),
      }),
    ),
  )

  const router = createRouter({
    routeTree: root.addChildren([start, ...pages]),
    ...(options.history ? { history: options.history } : {}),
  })

  // The router lives as long as the page, so it never stops listening.
  options.session.subscribe((user) => {
    if (!user) {
      void router.invalidate()
    }
  })

  return router
}
