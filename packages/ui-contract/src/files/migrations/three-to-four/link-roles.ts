/**
 * The roles of a link, dropped from a screen file where the loader derives them: a link bound to
 * one route whose roles admit fewer devices than the link's own screen serves (the frame serves
 * every role) takes the roles of that route, so the roles it writes that admit exactly what the
 * route's do (`sameAdmission`) go. Roles that admit other devices, and those of a link whose
 * route admits every device its screen serves, stay: the loader neither derives nor refuses them.
 * The roles in play are those the bindings of every screen serve.
 */

import { admitsAllOf, sameAdmission } from '../../../anchors'
import { isRecord } from '../../../records'
import { anchorsOf, type Plain, plainOf, type ScreenDocuments } from '../screens'

/** The roles of a list written as strings; none when it is no such list. */
const rolesIn = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((role: unknown) => typeof role === 'string')
    ? value.map(String)
    : undefined

/** The roles each binding of a screen file serves, by its path. */
function bindingRoles(screen: Plain): Array<[string, string[]]> {
  const bindings: unknown = screen['bindings']

  return (Array.isArray(bindings) ? bindings : []).flatMap((binding: unknown) => {
    const roles = isRecord(binding) ? rolesIn(binding['roles']) : undefined
    const path = isRecord(binding) ? binding['path'] : undefined

    return typeof path === 'string' && roles !== undefined
      ? [[path, roles] as [string, string[]]]
      : []
  })
}

/** The route a link is bound to, when its binding is that one route. */
function routeOf(def: Plain): string | undefined {
  const binding = def['binding']
  const route = isRecord(binding) ? binding['route'] : undefined

  return def['kind'] === 'link' && typeof route === 'string' ? route : undefined
}

/** Drops the roles of every link of `screens` that the loader derives from its route. */
export function dropLinkRoles(screens: ScreenDocuments): void {
  const read = [...screens].map(([, document]) => ({ document, screen: plainOf(document) }))
  const routes = new Map(read.flatMap(({ screen }) => bindingRoles(screen)))
  const universe = [...new Set([...routes.values()].flat())]

  for (const { document, screen } of read) {
    const served =
      screen['frame'] === true
        ? universe
        : [...new Set(bindingRoles(screen).flatMap(([, roles]) => roles))]

    for (const [anchor, def] of anchorsOf(screen)) {
      const route = routeOf(def)
      const roles = rolesIn(def['roles'])
      const admitted = route === undefined ? undefined : routes.get(route)

      if (
        admitted !== undefined &&
        roles !== undefined &&
        !admitsAllOf(admitted, served, universe) &&
        sameAdmission(roles, admitted, universe)
      ) {
        document.deleteIn(['anchors', anchor, 'roles'])
      }
    }
  }
}
