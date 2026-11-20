/**
 * One JSX element as the sources check reads it (`collect.ts`): its attributes, each prop a spread
 * on it supplies counted as written there, at the spread (`spreads.ts`), and marked partial where
 * some branch of the spread leaves it out; the anchor it carries, written on it or supplied by a
 * spread, as a literal, as `testIdFor()` of two literals, or through a `<NAME>_TEST_ID` constant of
 * its file (`locals.ts`); and where each spread on it the file cannot follow is written.
 */

import type { Expression, JSXAttributeValue, JSXOpeningElement } from 'oxc-parser'

import { testIdFor } from '../anchors'

import { DEPTH, type Locals } from './locals'
import { suppliedBy } from './spreads'
import {
  type CarriedAnchor,
  carriedAnchor,
  isTestIdFor,
  staticText,
  TEST_ID_CONSTANT,
  unwrap,
} from './values'

/** An anchor written as a `<NAME>_TEST_ID` constant its file does not declare (an import). */
export const UNDECLARED_ANCHOR = (name: string): string =>
  `"${name}" is no constant of this file: an anchor constant is read only in the file that declares it; declare it here, or write the anchor`

/** A spread on an element whose anchor the check reads, when the file cannot say what it supplies. */
export const UNFOLLOWED_SPREAD = (anchor: string): string =>
  `a spread on the element of "${anchor}" that the check cannot follow (a parameter, an import, a value built at runtime); write its props on the element, or build them in this file`

/** The name of a `<NAME>_TEST_ID` constant `node`, written at `at`, uses that its file does not bind. */
export function undeclaredAnchorOf(
  locals: Locals,
  node: Expression,
  at: number,
): string | undefined {
  const written = unwrap(node)

  return written.type === 'Identifier' &&
    TEST_ID_CONSTANT.test(written.name) &&
    !locals.declares(written.name, at)
    ? written.name
    : undefined
}

export interface ElementAttribute {
  readonly name: string
  readonly value: JSXAttributeValue | null
  /** The value a spread on the element supplies the prop with, where one does. */
  readonly spread?: Expression
  readonly start: number
  /** A spread's prop that some branch of the spread leaves out. */
  readonly partial?: true
}

export interface ReadElement {
  readonly attributes: readonly ElementAttribute[]
  /** The anchor it carries in a form the check reads; none for one passed through. */
  readonly carried?: CarriedAnchor
  /** Where each spread on it that the file cannot follow is written. */
  readonly unfollowed: readonly number[]
}

/** An attribute that carries an anchor: `data-testid`, `testId` or a `*TestId` prop. */
export const isAnchorAttribute = (name: string): boolean =>
  name === 'data-testid' || name === 'testId' || name.endsWith('TestId')

/** The expression of an attribute's value, or the one a spread supplies; none for a string. */
export const expressionOf = ({ value, spread }: ElementAttribute): Expression | undefined =>
  spread ??
  (value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression'
    ? value.expression
    : undefined)

/**
 * The anchor `node`, written at `at`, carries: a literal, `testIdFor()` of two literals, a
 * `<NAME>_TEST_ID` constant of the file that holds either, or `testIdFor()` of such a constant and a
 * literal suffix, which comes with its base; none for anything else, a name passed through included.
 */
export function anchorIn(
  locals: Locals,
  node: Expression,
  at: number,
  depth = 0,
): CarriedAnchor | undefined {
  const text = staticText(node)

  if (text !== undefined) {
    return { anchor: text }
  }

  const written = unwrap(node)

  if (depth >= DEPTH) {
    return undefined
  }

  if (written.type === 'Identifier' && TEST_ID_CONSTANT.test(written.name)) {
    // A constant may hold a literal, `testIdFor()` of two literals, or one of another constant.
    const declared = locals.valueNamed(written.name, at)

    return declared === undefined
      ? undefined
      : anchorIn(locals, declared, declared.start, depth + 1)
  }

  if (written.type !== 'CallExpression' || !isTestIdFor(written.callee)) {
    return undefined
  }

  const [base, suffix] = written.arguments
  const from =
    base === undefined || base.type === 'SpreadElement'
      ? undefined
      : anchorIn(locals, base, at, depth + 1)
  const part = staticText(suffix)

  return from === undefined || from.base !== undefined || part === undefined
    ? undefined
    : { anchor: testIdFor(from.anchor, part), base: from.anchor }
}

export function readElement(node: JSXOpeningElement, locals: Locals): ReadElement {
  const unfollowed: number[] = []
  const attributes = node.attributes.flatMap((attribute): ElementAttribute[] => {
    if (attribute.type === 'JSXAttribute') {
      return attribute.name.type === 'JSXIdentifier'
        ? [{ name: attribute.name.name, value: attribute.value, start: attribute.start }]
        : []
    }

    const { props, certain, followed } = suppliedBy(locals, attribute.argument, attribute.start)

    if (!followed) {
      unfollowed.push(attribute.start)
    }

    return props.map(({ name, value }) => ({
      name,
      value: null,
      spread: value,
      start: attribute.start,
      ...(certain.has(name) ? {} : { partial: true as const }),
    }))
  })
  const written = attributes.find(
    ({ spread, name }) => spread === undefined && isAnchorAttribute(name),
  )
  const supplied = attributes.find(
    ({ spread, name, partial }) =>
      spread !== undefined && partial !== true && isAnchorAttribute(name),
  )
  const carrier = written ?? supplied
  const expression = carrier === undefined ? undefined : expressionOf(carrier)
  const carried =
    carrier === undefined
      ? undefined
      : (carriedAnchor(carrier.value) ??
        (expression === undefined ? undefined : anchorIn(locals, expression, expression.start)))

  return { attributes, ...(carried === undefined ? {} : { carried }), unfollowed }
}
