/**
 * The roles of a link, derived from version 4: a `link` bound to one route is shown to the
 * devices that route opens, so when the route admits fewer devices than the link's own screen
 * serves (the frame serves every role), the link takes the roles of the route's binding. Roles
 * are read by what they admit (`admitsAllOf`, `sameAdmission`), never as sets of names, so
 * `[identity, member, admin]` and `[identity]` are the same roles: a device that holds `member` or
 * `admin` always holds `identity`. From version 4 a screen file never writes the roles it derives,
 * and written roles that admit exactly what the route's do are a problem; roles that admit fewer
 * devices stay, as the author's own. Before version 4 nothing is derived and what a file writes
 * is accepted as written. The roles in play are the ones the bindings of the screens serve.
 */

import { admitsAllOf, sameAdmission } from '../../anchors'
import { jsonPath, type Problem } from '../problems'
import type { AnchorDef, Binding, Screen } from '../screens'

/** The version from which the roles of a link are derived, and a screen file never writes them. */
const LINK_ROLES_EDITION = 4

/** The path of the route a link is bound to, when its binding is that one route. */
function routeOf(def: AnchorDef): string | undefined {
  const { binding } = def

  return def.kind === 'link' &&
    binding !== undefined &&
    !Array.isArray(binding) &&
    'route' in binding
    ? binding.route
    : undefined
}

/** The roles the bindings of `screen` serve; every role of `universe` for the frame, which has none. */
const servedBy = (screen: Screen, universe: readonly string[]): string[] =>
  screen.frame === true
    ? [...universe]
    : [...new Set(screen.bindings.flatMap(({ roles }) => roles))]

/** A screen as the loader holds it, with the file it was read from. */
export interface LoadedScreen {
  readonly file: string
  readonly screen: Screen
}

/**
 * The screens with the roles of each link derived, in their order, and the problems of roles a
 * file writes that the route derives, each filed under the file of its screen.
 */
export function withDerivedLinkRoles(
  loaded: readonly LoadedScreen[],
  edition: number,
): { screens: Screen[]; problems: Problem[] } {
  if (edition < LINK_ROLES_EDITION) {
    return { screens: loaded.map(({ screen }) => screen), problems: [] }
  }

  const bindings = new Map<string, Binding>(
    loaded.flatMap(({ screen }) =>
      screen.bindings.map((binding) => [binding.path, binding] as const),
    ),
  )
  const universe = [...new Set([...bindings.values()].flatMap(({ roles }) => roles))]
  const problems: Problem[] = []

  const derived = loaded.map(({ file, screen }) => {
    const served = servedBy(screen, universe)

    return {
      ...screen,
      anchors: Object.fromEntries(
        Object.entries(screen.anchors).map(([anchor, def]): [string, AnchorDef] => {
          const route = routeOf(def)
          const roles = route === undefined ? undefined : bindings.get(route)?.roles

          if (route === undefined || roles === undefined || admitsAllOf(roles, served, universe)) {
            return [anchor, def]
          }

          if (def.roles === undefined) {
            return [anchor, { ...def, roles: [...roles] }]
          }

          if (sameAdmission(def.roles, roles, universe)) {
            problems.push({
              file,
              message: `${jsonPath(['anchors', anchor, 'roles'])}: roles are derived from the route "${route}"; leave them out`,
            })
          }

          return [anchor, def]
        }),
      ),
    }
  })

  return { screens: derived, problems }
}
