/**
 * What an anchor's value is, as the collector sees it: a literal it can check, a name or
 * a `testIdFor()` call that passes through (the literal is declared elsewhere), or a
 * string built at runtime, which no check can follow.
 */

import type { Argument, Expression, JSXAttributeValue, PropertyKey } from 'oxc-parser'

import { testIdFor } from '../anchors'

export type AnchorValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'pass' }
  | { readonly kind: 'runtime' }

/** The expression under the wrappers that do not change a value at runtime. */
export function unwrap(node: Expression): Expression {
  switch (node.type) {
    case 'ParenthesizedExpression':
    case 'ChainExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return unwrap(node.expression as Expression)
    default:
      return node
  }
}

/** The text of a string literal or of a template without expressions. */
export function staticText(node: Expression | Argument | undefined): string | undefined {
  if (node === undefined || node.type === 'SpreadElement') {
    return undefined
  }

  const value = unwrap(node)

  if (value.type === 'Literal' && typeof value.value === 'string') {
    return value.value
  }

  if (value.type === 'TemplateLiteral' && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? undefined
  }

  return undefined
}

export const isTestIdFor = (node: Expression): boolean =>
  node.type === 'Identifier' && node.name === 'testIdFor'

/** An anchor a prop carries, with the base it derives from when `testIdFor()` builds it. */
export interface CarriedAnchor {
  readonly anchor: string
  readonly base?: string
}

/**
 * The anchor a `testIdFor(<text>, <text>)` call builds, `<base>.<suffix>`, with its `base`; no
 * anchor for any other expression, a call whose base or suffix is not a literal included.
 */
export function derivedAnchorOf(node: Expression): Required<CarriedAnchor> | undefined {
  const call = unwrap(node)

  if (call.type !== 'CallExpression' || !isTestIdFor(call.callee)) {
    return undefined
  }

  const base = staticText(call.arguments[0])
  const suffix = staticText(call.arguments[1])

  return base === undefined || suffix === undefined
    ? undefined
    : { anchor: testIdFor(base, suffix), base }
}

export function anchorValue(node: Expression): AnchorValue {
  const text = staticText(node)

  if (text !== undefined) {
    return { kind: 'literal', text }
  }

  const value = unwrap(node)

  if (
    value.type === 'Identifier' ||
    value.type === 'MemberExpression' ||
    (value.type === 'CallExpression' && isTestIdFor(value.callee))
  ) {
    return { kind: 'pass' }
  }

  return { kind: 'runtime' }
}

/** The value of a JSX attribute: `"x"`, `{expression}`, or something no anchor is. */
export function attributeValue(value: JSXAttributeValue | null): AnchorValue {
  if (value?.type === 'Literal') {
    return { kind: 'literal', text: value.value }
  }

  if (value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression') {
    return anchorValue(value.expression)
  }

  return { kind: 'runtime' }
}

/**
 * The anchor an attribute carries in full: a literal, or `testIdFor()` of two literals, which
 * comes with its base. A name, a member or a string built at runtime carries no anchor a check
 * can read.
 */
export function carriedAnchor(value: JSXAttributeValue | null): CarriedAnchor | undefined {
  const read = attributeValue(value)

  if (read.kind === 'literal') {
    return { anchor: read.text }
  }

  return value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression'
    ? derivedAnchorOf(value.expression)
    : undefined
}

/** The name of a property key written as a name or a string: `testId`, `'testId'`. */
export function keyName(key: PropertyKey, computed: boolean): string | undefined {
  if (key.type === 'Identifier' && !computed) {
    return key.name
  }

  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined
}
