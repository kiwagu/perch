/** The names a binding pattern binds, for `locals.ts` to scope each one, with their keys where it destructures. */

import type { BindingPattern, BindingRestElement, ParamPattern } from 'oxc-parser'

import { keyName } from './values'

/** The names a binding pattern binds: `a`, `{ a, b: c }` binds `a` and `c`, `[a, ...b]` both. */
export function namesIn(pattern: BindingPattern | ParamPattern | BindingRestElement): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name]
    case 'AssignmentPattern':
      return namesIn(pattern.left)
    case 'RestElement':
      return namesIn(pattern.argument)
    case 'ObjectPattern':
      return pattern.properties.flatMap((property) =>
        namesIn(property.type === 'RestElement' ? property : property.value),
      )
    case 'ArrayPattern':
      return pattern.elements.flatMap((element) => (element === null ? [] : namesIn(element)))
    case 'TSParameterProperty':
      return namesIn(pattern.parameter)
    default:
      return []
  }
}

/** A name a destructuring binds, with the keys that lead to it from the value destructured. */
export interface DestructuredName {
  readonly name: string
  /** The keys, outermost first; none where the pattern does not say (a rest, an array, a computed key). */
  readonly path?: readonly string[]
}

/** The names `const { a, b: { c } } = value` binds: `a` at `['a']`, `c` at `['b', 'c']`. */
export function pathsIn(
  pattern: BindingPattern | BindingRestElement,
  path: readonly string[] = [],
): DestructuredName[] {
  switch (pattern.type) {
    case 'Identifier':
      return [{ name: pattern.name, path }]
    case 'AssignmentPattern':
      return pathsIn(pattern.left, path)
    case 'ObjectPattern':
      return pattern.properties.flatMap((property) => {
        const key =
          property.type === 'RestElement' ? undefined : keyName(property.key, property.computed)

        return property.type === 'RestElement' || key === undefined
          ? namesIn(property.type === 'RestElement' ? property : property.value).map((name) => ({
              name,
            }))
          : pathsIn(property.value, [...path, key])
      })
    default:
      return namesIn(pattern).map((name) => ({ name }))
  }
}
