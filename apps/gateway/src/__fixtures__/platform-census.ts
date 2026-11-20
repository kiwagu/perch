/**
 * The census of the routes the gateway serves against the routes the platform's actions and the
 * reasons name: which served route nothing names, and which name no served route.
 */

import { ACTION_ROUTES, NO_ACTION_ROUTES, SERVER_ROUTES } from './platform-routes'

/** The routes the actions and the reasons name, each as `METHOD path`. */
const named = [
  ...Object.values(ACTION_ROUTES).map(({ method, path }) => `${method} ${path}`),
  ...Object.keys(NO_ACTION_ROUTES),
]

/** The routes of `served` no action and no reason names. */
export const unnamed = (served: readonly string[]): string[] =>
  served.filter((route) => !named.includes(route))

/** The routes an action or a reason names that `served` lacks, the server's own aside. */
export const stale = (served: readonly string[]): string[] =>
  named.filter((route) => !served.includes(route) && !SERVER_ROUTES.includes(route))

/** The routes the paths answer, each as `METHOD path`, and the paths that answer none. */
export async function census(
  paths: readonly string[],
  allow: (path: string) => Promise<string | null>,
): Promise<{ served: string[]; unserved: string[] }> {
  const served: string[] = []
  const unserved: string[] = []

  for (const path of paths) {
    const methods = ((await allow(path)) ?? '').split(', ').filter((method) => method !== '')

    unserved.push(...(methods.length === 0 ? [path] : []))
    served.push(...methods.map((method) => `${method} ${path}`))
  }

  return { served, unserved }
}
