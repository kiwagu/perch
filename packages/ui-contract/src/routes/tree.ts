/**
 * The route tree the screen folder describes, as the router holds it: `__root`, the frame
 * around every screen, then each binding under its parent, the binding whose path is the
 * longest proper prefix of its own on whole segments (`/org` for `/org/$org`), else the
 * root. A path of no segments (`/`) is the root's index and parents nothing.
 */

import type { Binding, Screen } from '../files'

/** The root route's name in TanStack Router's syntax. */
export const ROOT_ROUTE = '__root'

/** A route of the tree: the root, or a binding with its screen, its guard and its parent. */
export interface RouteNode {
  readonly path: string
  /** The screen at the route: the frame at the root (none without one). */
  readonly screen: string | null
  readonly guard: NonNullable<Binding['guard']> | null
  /** The parent's path, `__root` at the top; null for the root itself. */
  readonly parent: string | null
}

const segmentsOf = (path: string): string[] => (path === '/' ? [] : path.slice(1).split('/'))

const isPrefix = (prefix: readonly string[], of: readonly string[]): boolean =>
  prefix.length < of.length && prefix.every((segment, index) => segment === of[index])

/** The parent of `path` among `paths`: the longest proper prefix of one segment or more. */
function parentOf(path: string, paths: readonly string[]): string {
  const segments = segmentsOf(path)
  const prefixes = paths
    .map(segmentsOf)
    .filter((candidate) => candidate.length > 0 && isPrefix(candidate, segments))
    .sort((a, b) => b.length - a.length)
  const [longest] = prefixes

  return longest === undefined ? ROOT_ROUTE : `/${longest.join('/')}`
}

/** The tree in the order it is read: the root, then depth first, siblings by path. */
export function routeTree(screens: readonly Screen[]): RouteNode[] {
  const routes = screens
    .flatMap((screen) =>
      screen.bindings.map(({ path, guard }) => ({ path, screen: screen.id, guard: guard ?? null })),
    )
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const paths = routes.map(({ path }) => path)
  const nodes = routes.map((route) => ({ ...route, parent: parentOf(route.path, paths) }))
  const below = (parent: string): RouteNode[] =>
    nodes.filter((node) => node.parent === parent).flatMap((node) => [node, ...below(node.path)])
  const frame = screens.find((screen) => screen.frame === true)

  return [
    { path: ROOT_ROUTE, screen: frame?.id ?? null, guard: null, parent: null },
    ...below(ROOT_ROUTE),
  ]
}
