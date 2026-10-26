/**
 * The routes of the contract as one view, from the screen files: per binding, sorted by path,
 * its screen, guard, roles, history, the names of its parameters and search keys, its file,
 * its example link (`exampleOf`) and where it is reached from (the anchors that link to it
 * with `binding.route`, the screens whose flow navigates to it, and the states of the
 * activities whose address it is); then the route tree (`routeTree`).
 */

import { bindingRefsOf, type Contract, flowNodes, transitionsOf } from '../check'
import type { Binding, Effect, Flow, Screen } from '../files'

import { exampleOf } from './example'
import { type RouteNode, routeTree } from './tree'

/** Where a route is reached from. */
export interface ReachedFrom {
  /** The anchors whose binding is a link to the route: `app-shell.nav.profile-link`. */
  readonly links: readonly string[]
  /** The screens whose flow navigates to the route. */
  readonly navigate: readonly string[]
  /** The states of the activities at the route, as `<activity>.<state>`. */
  readonly activities: readonly string[]
}

export interface RouteRow {
  readonly path: string
  readonly screen: string
  readonly guard: NonNullable<Binding['guard']> | null
  readonly roles: readonly string[]
  readonly history: Binding['history']
  /** The names of its path parameters. */
  readonly params: readonly string[]
  /** The names of its search keys, in their declared order. */
  readonly search: readonly string[]
  readonly file: string
  /** A deep link to the route with fake data (`exampleOf`). */
  readonly example: string
  readonly reachedFrom: ReachedFrom
}

export interface RoutesView {
  readonly routes: readonly RouteRow[]
  readonly tree: readonly RouteNode[]
}

/**
 * Every path a flow navigates to: in the `entry` and `exit` and the transitions of its
 * states, a parallel state's own and its regions' states included.
 */
function navigatesTo(flow: Flow): Set<string> {
  const effects: Effect[] = flowNodes(flow).flatMap((node) =>
    node.kind === 'region'
      ? []
      : [
          ...(node.state.entry ?? []),
          ...(node.state.exit ?? []),
          ...transitionsOf(node.state).flatMap(({ actions }) => actions ?? []),
        ],
  )

  return new Set(
    effects.flatMap((effect) => (effect.type === 'navigate' ? [effect.params.to] : [])),
  )
}

const linksTo = (screens: readonly Screen[], path: string): string[] =>
  screens.flatMap((screen) =>
    Object.entries(screen.anchors)
      .filter(([, def]) =>
        bindingRefsOf(def).some(({ ref }) => 'route' in ref && ref.route === path),
      )
      .map(([anchor]) => anchor),
  )

function reachedFrom(contract: Contract, path: string): ReachedFrom {
  const { screens } = contract.screens

  return {
    links: linksTo(screens, path),
    navigate: screens
      .filter(({ flow }) => flow !== undefined && navigatesTo(flow).has(path))
      .map(({ id }) => id),
    activities: contract.activities.flatMap((activity) =>
      Object.entries(activity.states)
        .filter(([, state]) => state.meta.address.path === path)
        .map(([state]) => `${activity.id}.${state}`),
    ),
  }
}

/** The file of the screen at `index`: every screen has one. */
function fileOf(files: readonly string[], index: number): string {
  const file = files[index]

  if (file === undefined) {
    throw new Error(`no screen file holds screens[${index}]`)
  }

  return file
}

export function routesOf(contract: Contract): RoutesView {
  const { screens, files } = contract.screens
  const routes = screens
    .flatMap((screen, index) =>
      screen.bindings.map(
        (binding): RouteRow => ({
          path: binding.path,
          screen: screen.id,
          guard: binding.guard ?? null,
          roles: binding.roles,
          history: binding.history,
          params: Object.keys(binding.params?.properties ?? {}),
          search: Object.keys(binding.search?.properties ?? {}),
          file: fileOf(files, index),
          example: exampleOf(binding).link,
          reachedFrom: reachedFrom(contract, binding.path),
        }),
      ),
    )
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))

  return { routes, tree: routeTree(screens) }
}
