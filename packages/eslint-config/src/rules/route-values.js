/**
 * Where a string names a route of the contract by its value: the route itself or followed by a
 * search or a hash, behind a Playwright glob's `**` too; a part of a template literal that starts with one; a regular expression that
 * names one where it ends. A route holding `$` (a splat) is a router path, never a URL, so only
 * the whole string names it.
 */

/** `text` without a Playwright URL glob's leading `**`. */
const withoutGlob = (text) => (text.startsWith('**/') ? text.slice(2) : text)

/**
 * The route `text` names by its value: the route itself, or a route followed by `?` or `#`; after
 * a Playwright URL glob's `**` too (`**` then `/me`, or `/settings?*`).
 */
export function routeNamedBy(text, routes) {
  const plain = withoutGlob(text)

  for (const route of routes.keys()) {
    if (
      plain === route ||
      (!route.includes('$') && (plain.startsWith(`${route}?`) || plain.startsWith(`${route}#`)))
    ) {
      return route
    }
  }

  return undefined
}

/**
 * The route a part of a template literal starts with (behind a glob's `**` too), an expression or
 * the end right after it.
 */
export function routeStartingQuasi(text, routes) {
  const plain = withoutGlob(text)

  for (const route of routes.keys()) {
    if (!route.includes('$') && plain.startsWith(route)) {
      const next = plain.charAt(route.length)

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
