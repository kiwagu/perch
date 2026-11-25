/**
 * The object a spread of a queried template writes, as its type has it (`asked-event.ts`): an
 * object literal, in parentheses, `as const` or `satisfies`, or one a `const` of the file holds that
 * it writes no type for (`Locals.declaredTypeOf`); none for anything else, whose type may differ
 * from the object the file follows it to (an annotation, another assertion, a call, a parameter).
 */

import type { Expression, ObjectExpression } from 'oxc-parser'

import { isConstType } from './allowed-values'
import { DEPTH } from './alternatives'
import type { Locals } from './locals'

export function writtenObject(
  locals: Locals,
  node: Expression,
  depth = 0,
): ObjectExpression | undefined {
  if (depth >= DEPTH) {
    return undefined
  }

  switch (node.type) {
    case 'ParenthesizedExpression':
    case 'TSSatisfiesExpression':
      return writtenObject(locals, node.expression, depth)
    case 'TSAsExpression':
      return isConstType(node.typeAnnotation)
        ? writtenObject(locals, node.expression, depth)
        : undefined
    case 'ObjectExpression':
      return node
    case 'Identifier': {
      const value = locals.constantNamed(node.name, node.start)

      return value === undefined || locals.declaredTypeOf(node, node.start) !== undefined
        ? undefined
        : writtenObject(locals, value, depth + 1)
    }
    default:
      return undefined
  }
}
