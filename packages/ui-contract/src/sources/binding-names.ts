/**
 * The names a binding pattern binds, for `locals.ts` to scope each one, with their keys where it
 * destructures, and the type an annotation writes for each.
 */

import type { BindingPattern, BindingRestElement, ParamPattern, TSType } from 'oxc-parser'

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
  /** Whether a default stands in on the way to it (`{ a = b }`), so it may hold another value. */
  readonly defaulted?: true
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
      return pathsIn(pattern.left, path).map((name) => ({ ...name, defaulted: true }))
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

/** A type the file writes for a value, and the keys down to a name in it, outermost first. */
export interface WrittenType {
  readonly type: TSType
  readonly path: readonly string[]
}

/** A name a pattern binds, with the type its annotation writes for it, where it writes one. */
export interface TypedName {
  readonly name: string
  readonly declared?: WrittenType
}

/**
 * The names a pattern binds, typed where its annotation says: `props: Props` binds `props` as
 * `Props`, `{ draft }: Props` binds `draft` as `Props` at `['draft']`, a default of the whole
 * pattern (`{ draft }: Props = fallback`) being of that type too. A name a rest, an array, a
 * computed key or a default of its own (`{ draft = fallback }`) binds has no type written for it.
 */
export function typedNamesIn(pattern: BindingPattern | ParamPattern): TypedName[] {
  const typed = pattern.type === 'AssignmentPattern' ? pattern.left : pattern
  const type =
    typed.type === 'Identifier' || typed.type === 'ObjectPattern'
      ? typed.typeAnnotation?.typeAnnotation
      : undefined

  if (type !== undefined && typed.type === 'Identifier') {
    return [{ name: typed.name, declared: { type, path: [] } }]
  }

  if (type !== undefined && typed.type === 'ObjectPattern') {
    return pathsIn(typed).map(({ name, path, defaulted }) =>
      path === undefined || defaulted === true ? { name } : { name, declared: { type, path } },
    )
  }

  return namesIn(pattern).map((name) => ({ name }))
}
