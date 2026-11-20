/**
 * What a spread on an element supplies, as far as its file says (`locals.ts`): the collector counts
 * each prop as written on the element, so a view cannot slip a field fact past the check by
 * grouping its props in an object or a helper (`{...field('email')}`).
 */

import type { Expression } from 'oxc-parser'

import { type Alternative, DEPTH, type Locals } from './locals'
import { keyName } from './values'

/** A prop an object supplies, by its name, with the value it is written with. */
export interface SuppliedProp {
  readonly name: string
  readonly value: Expression
}

/**
 * The props a spread on an element supplies, each with the value it is written with: the
 * properties of each object it may be, and those of each object such an object spreads in turn
 * (`{ ...field(name), onChange }`), as far as the file says; none for a spread it cannot follow (a
 * component's own props passed on).
 */
export function spreadPropsOf(locals: Locals, argument: Expression, at: number): SuppliedProp[] {
  const propsOf = (objects: readonly Alternative[], depth: number): SuppliedProp[] =>
    depth >= DEPTH
      ? []
      : objects.flatMap((object) =>
          (object ?? { properties: [] }).properties.flatMap((property): SuppliedProp[] => {
            if (property.type === 'SpreadElement') {
              return propsOf(locals.objectsOf(property.argument, property.start), depth + 1)
            }

            const name =
              property.kind === 'init' ? keyName(property.key, property.computed) : undefined

            return name === undefined || property.method ? [] : [{ name, value: property.value }]
          }),
        )

  return propsOf(locals.objectsOf(argument, at), 0)
}
