/**
 * The values a type the file writes allows a key to hold, as far as the file itself says, for the
 * `type` member of the type of a spread `asked-event.ts` cannot follow: a string literal type, a
 * query of the key of a name (`typeof reset.type`, left to the caller to read, where `reset` is the
 * file's own value), or a union of such types, in parentheses or not. Anything else, `string`, an
 * import, a generic, a template, a query of another member or of a longer path, says nothing of
 * which values it allows, so none are read.
 */

import type { IdentifierReference, TSType } from 'oxc-parser'

/** A value a type allows: a string, or the `key` of the name a query writes, as it is written. */
export type AllowedValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'query'; readonly reference: IdentifierReference }

/** The values `type` allows for `key`; none where it does not say which, or allows more. */
export function allowedValues(type: TSType, key: string): AllowedValue[] | undefined {
  switch (type.type) {
    case 'TSParenthesizedType':
      return allowedValues(type.typeAnnotation, key)
    case 'TSUnionType': {
      const each = type.types.map((member) => allowedValues(member, key))

      return each.every((values) => values !== undefined) ? each.flat() : undefined
    }
    case 'TSLiteralType':
      return type.literal.type === 'Literal' && typeof type.literal.value === 'string'
        ? [{ kind: 'literal', text: type.literal.value }]
        : undefined
    case 'TSTypeQuery': {
      const { exprName, typeArguments } = type

      return exprName.type === 'TSQualifiedName' &&
        exprName.left.type === 'Identifier' &&
        exprName.right.name === key &&
        typeArguments === null
        ? [{ kind: 'query', reference: exprName.left }]
        : undefined
    }
    default:
      return undefined
  }
}
