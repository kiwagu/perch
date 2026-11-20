/**
 * The values a type the file writes allows a key to hold, as far as the file itself says, for the
 * `type` member of the type of a spread `asked-event.ts` cannot follow: a string literal type, a
 * query of the key of a name (`typeof reset.type`, left to the caller to read, where `reset` is the
 * file's own value), a query of a name a `const` of the file binds where the query is written
 * (`typeof SAVE_TEST_ID`, `Locals.constantNamed`), read as that const's type, or a union of such
 * types, in parentheses or not. A const's type is its annotation where it has one, read as here, and
 * else the one string its value writes: a string literal or a template without expressions, in
 * parentheses, `as const` or `satisfies`, or another such const by its name. Anything else says
 * nothing of which values it allows, so none are read: `string`, an import, a generic, a template, a
 * query of another member or of a longer path, or one of a `let`, a `var`, a parameter, an import,
 * or a const declared with another value (a `testIdFor()` call is typed `string`, which allows any).
 */

import type { Expression, IdentifierReference, TSType } from 'oxc-parser'

import { DEPTH } from './alternatives'
import type { Locals } from './locals'
import { staticText } from './values'

/** A value a type allows: a string, or the `key` of the name a query writes, as it is written. */
export type AllowedValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'query'; readonly reference: IdentifierReference }

/** The values `type` allows for `key`; none where it does not say which, or allows more. */
export function allowedValues(
  type: TSType,
  key: string,
  locals: Locals,
  depth = 0,
): AllowedValue[] | undefined {
  switch (type.type) {
    case 'TSParenthesizedType':
      return allowedValues(type.typeAnnotation, key, locals, depth)
    case 'TSUnionType': {
      const each = type.types.map((member) => allowedValues(member, key, locals, depth))

      return each.every((values) => values !== undefined) ? each.flat() : undefined
    }
    case 'TSLiteralType':
      return type.literal.type === 'Literal' && typeof type.literal.value === 'string'
        ? [{ kind: 'literal', text: type.literal.value }]
        : undefined
    case 'TSTypeQuery': {
      const { exprName, typeArguments } = type

      if (typeArguments !== null) {
        return undefined
      }

      if (exprName.type === 'Identifier') {
        return constantValues(exprName, key, locals, depth)
      }

      return exprName.type === 'TSQualifiedName' &&
        exprName.left.type === 'Identifier' &&
        exprName.right.name === key
        ? [{ kind: 'query', reference: exprName.left }]
        : undefined
    }
    default:
      return undefined
  }
}

/** The values the type of the `const` a name, where it is written, stands for allows; none else. */
function constantValues(
  name: IdentifierReference,
  key: string,
  locals: Locals,
  depth: number,
): AllowedValue[] | undefined {
  const value = locals.constantNamed(name.name, name.start)

  if (value === undefined || depth >= DEPTH) {
    return undefined
  }

  const annotation = locals.declaredTypeOf(name, name.start)

  return annotation === undefined
    ? valueValues(value, key, locals, depth + 1)
    : allowedValues(annotation, key, locals, depth + 1)
}

/**
 * The one string the type of an unannotated const's value is, which a `const` keeps as its type;
 * none for any other value, a call or a wider `as` (`'x' as string`) included.
 */
function valueValues(
  value: Expression,
  key: string,
  locals: Locals,
  depth: number,
): AllowedValue[] | undefined {
  switch (value.type) {
    case 'ParenthesizedExpression':
    case 'TSSatisfiesExpression':
      return valueValues(value.expression, key, locals, depth)
    case 'TSAsExpression': {
      const { typeAnnotation } = value

      return typeAnnotation.type === 'TSTypeReference' &&
        typeAnnotation.typeName.type === 'Identifier' &&
        typeAnnotation.typeName.name === 'const'
        ? valueValues(value.expression, key, locals, depth)
        : undefined
    }
    case 'Identifier':
      return constantValues(value, key, locals, depth)
    case 'Literal':
    case 'TemplateLiteral': {
      const text = staticText(value)

      return text === undefined ? undefined : [{ kind: 'literal', text }]
    }
    default:
      return undefined
  }
}
