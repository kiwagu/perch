/**
 * Builds the application router from the module manifests. Each module route
 * becomes a page; `authenticated` pages send visitors to sign-in, `guest` pages
 * send a signed-in user to the profile, and `/` opens whichever applies.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  redirect,
} from '@tanstack/react-router'
import type { FunctionComponent } from 'react'

import type { AuthUser } from '@workspace/data'

import type { ModuleDef, RouteDef } from './module'

export const SIGN_IN_PATH = '/sign-in'

export const HOME_PATH = '/me'

export interface AppRouterOptions {
  readonly modules: readonly ModuleDef[]
  readonly session: { current(): AuthUser | undefined }
  readonly layout: FunctionComponent
  readonly history?: RouterHistory
}

function allModules(modules: readonly ModuleDef[]): ModuleDef[] {
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
        component: module.declarations[route.page] ?? (() => null),
        beforeLoad: guard(route),
      }),
    ),
  )

  return createRouter({
    routeTree: root.addChildren([start, ...pages]),
    ...(options.history ? { history: options.history } : {}),
  })
}
