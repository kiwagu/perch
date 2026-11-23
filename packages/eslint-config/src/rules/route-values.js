/**
 * Where a string names a route of the contract by its value: the route itself or followed by a
 * search or a hash; a part of a template literal that starts with one; a regular expression that
 * names one where it ends. A route holding `$` (a splat) is a router path, never a URL, so only
 * the whole string names it.
 */

/** The route `text` names by its value: the route itself, or a route followed by `?` or `#`. */
export function routeNamedBy(text, routes) {
  for (const route of routes.keys()) {
    if (
      text === route ||
      (!route.includes('$') && (text.startsWith(`${route}?`) || text.startsWith(`${route}#`)))
    ) {
      return route
    }
  }

  return undefined
}

/** The route a part of a template literal starts with, an expression or the end right after it. */
export function routeStartingQuasi(text, routes) {
  for (const route of routes.keys()) {
    if (!route.includes('$') && text.startsWith(route)) {
      const next = text.charAt(route.length)

      if (next === '' || next === '?' || next === '#') {
        return route
      }
    }
  }

  return undefined
}

/** The route a regular expression names where it ends: `/\/me$/`, `/^\/settings(\?|$)/`. */
export function routeInPattern(pattern, routes) {
  const text = pattern.replaceAll('\\/', '/')

  for (const route of routes.keys()) {
    if (route.includes('$')) {
      continue
    }

    for (let at = text.indexOf(route); at !== -1; at = text.indexOf(route, at + 1)) {
      const before = at === 0 ? '' : text.charAt(at - 1)
      const after = text.slice(at + route.length)

      if (!/[\w-]/.test(before) && /^($|\$|\\\?|#|\(|\)|\|)/.test(after)) {
        return route
      }
    }
  }

  return undefined
}
