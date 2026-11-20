/** The names a binding pattern binds, for `locals.ts` to scope each one. */

import type { BindingPattern, BindingRestElement, ParamPattern } from 'oxc-parser'

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
