/**
 * The values a type the file writes allows a key to hold, as far as the file itself says, for the
 * `type` member of the type of a spread `asked-event.ts` cannot follow: a string literal type, a
 * query of the key of a name (`typeof reset.type`, left to the caller to read, where `reset` is the
 * file's own value), a query of a name a `const` of the file binds where the query is written
 * (`typeof SAVE_TEST_ID`, `Locals.constantNamed`), read as that const's type, or a union of such
 * types, in parentheses or not. A const's type is its annotation where it has one, read as here,
 * and else the type of its value (`valueAllows`, which the caller reads the value of a queried
 * member of an `as const` object with too): the one string a string literal or a template without
 * expressions writes, in parentheses, `as const` or `satisfies`, or another such const by its name;
 * under any other assertion (`<value> as <T>`, `<T><value>`) the value has the type `T`, which may
 * allow more than the value holds, so `T` is read as an annotation is, but only where the value
 * itself reads as strings `T` states: an assertion may narrow as well, so one of a value the file
 * does not state, or of another string, says nothing (`testIdFor('sample', 'a-button') as
 * 'sample.save-button'`). Anything else says nothing of which values it allows, so none are read:
 * `string`, an import, a generic, a template, a query of another member or of a longer path, or one
 * of a `let`, a `var`, a parameter, an import, or a const declared with another value (a
 * `testIdFor()` call is typed `string`, which allows any).
 */

import type { Expression, IdentifierReference, TSType } from 'oxc-parser'

import { DEPTH } from './alternatives'
import type { Locals } from './locals'
import { staticText } from './values'

/** A value a type allows: a string, or the `key` of the name a query writes, as it is written. */
export type AllowedValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'query'; readonly reference: IdentifierReference }

/**
 * How the caller reads the events a query of a name's key stands for (`typeof defaults.type`,
 * `asked-event.ts`), where it can, for an assertion to be checked against them.
 */
export type QueryReader = (
  query: Extract<AllowedValue, { kind: 'query' }>,
) => readonly string[] | undefined

/** Whether an assertion's type is `const`, which keeps the literal its value writes. */
export const isConstType = (type: TSType): boolean =>
  type.type === 'TSTypeReference' &&
  type.typeName.type === 'Identifier' &&
  type.typeName.name === 'const'

/** The values `type` allows for `key`; none where it does not say which, or allows more. */
export function allowedValues(
  type: TSType,
  key: string,
  locals: Locals,
  depth = 0,
  read?: QueryReader,
): AllowedValue[] | undefined {
  switch (type.type) {
    case 'TSParenthesizedType':
      return allowedValues(type.typeAnnotation, key, locals, depth, read)
    case 'TSUnionType': {
      const each = type.types.map((member) => allowedValues(member, key, locals, depth, read))

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
        return constantValues(exprName, key, locals, depth, read)
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
  read: QueryReader | undefined,
): AllowedValue[] | undefined {
  const value = locals.constantNamed(name.name, name.start)

  if (value === undefined || depth >= DEPTH) {
    return undefined
  }

  const annotation = locals.declaredTypeOf(name, name.start)

  return annotation === undefined
    ? valueAllows(value, key, locals, depth + 1, read)
    : allowedValues(annotation, key, locals, depth + 1, read)
}

/** The strings values stand for, a query read as `read` says; none where one cannot be read. */
const textsOf = (
  values: readonly AllowedValue[] | undefined,
  read: QueryReader | undefined,
): string[] | undefined => {
  const each = values?.map((value) => (value.kind === 'literal' ? [value.text] : read?.(value)))

  return each?.every((texts) => texts !== undefined) === true
    ? each.flatMap((texts) => texts ?? [])
    : undefined
}

/**
 * The values the type of a value the file writes allows, as an unannotated const or a member of an
 * `as const` object keeps it: the one string it writes, or what the type an assertion other than
 * `as const` gives it allows (`'x' as 'x' | 'y'` both, `'x' as string` none), where the value it
 * asserts reads as strings that type allows (`'y' as 'x'` none), a query in either read as `read`
 * says (`'x' as typeof defaults.type`, where `defaults.type` is `'x'`); none for any other value,
 * a call included.
 */
export function valueAllows(
  value: Expression,
  key: string,
  locals: Locals,
  depth = 0,
  read?: QueryReader,
): AllowedValue[] | undefined {
  switch (value.type) {
    case 'ParenthesizedExpression':
    case 'TSSatisfiesExpression':
      return valueAllows(value.expression, key, locals, depth, read)
    case 'TSAsExpression':
    case 'TSTypeAssertion': {
      const held = valueAllows(value.expression, key, locals, depth, read)

      if (isConstType(value.typeAnnotation)) {
        return held
      }

      const typed = allowedValues(value.typeAnnotation, key, locals, depth, read)
      const allows = textsOf(typed, read)
      const holds = textsOf(held, read)

      return allows !== undefined && holds?.every((text) => allows.includes(text)) === true
        ? typed
        : undefined
    }
    case 'Identifier':
      return constantValues(value, key, locals, depth, read)
    case 'Literal':
    case 'TemplateLiteral': {
      const text = staticText(value)

      return text === undefined ? undefined : [{ kind: 'literal', text }]
    }
    default:
      return undefined
  }
}
