/**
 * What the kit takes from the contract's field facts, which the sources leave to it: the words every
 * such refusal ends with, and a `required` a wrapper fixes on the field it passes an anchor to. The
 * kit lets a `required` written on its field win over the fact, so on an element that may pass on an
 * anchor the check cannot read (an anchor attribute it cannot read, or a spread, which may carry
 * one), a `required` that fixes the value is refused: a boolean literal (bare, `{true}`,
 * `{false}`, behind a type assertion, or one a spread supplies), or a name whose own default is one
 * (`({ required = false }) => <Input required={required} … />`). A name with no such default, a
 * member or an expression passed on is let by, as the kit's own `required ?? facts?.required` is,
 * and an element that passes on no anchor at all is no wrapper's field.
 */

import type { Expression, JSXOpeningElement } from 'oxc-parser'

import type { Problem } from '../files'

import { type ElementAttribute, expressionOf, isAnchorAttribute, type ReadElement } from './element'
import type { Locals } from './locals'
import { unwrap } from './values'

export const LEFT_TO_THE_KIT = "the kit takes it from the contract's field facts; leave it out"

export const REQUIRED_ANCHOR = `required on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

/** Whether a value is a boolean literal, under the wrappers that change nothing at runtime. */
const isBoolean = (node: Expression): boolean => {
  const value = unwrap(node)

  return value.type === 'Literal' && typeof value.value === 'boolean'
}

/** Whether a `required` fixes the field's value: a boolean literal, or a name defaulted to one. */
const fixes = (attribute: ElementAttribute, locals: Locals): boolean => {
  const expression = expressionOf(attribute)

  if (expression === undefined) {
    return attribute.value === null
  }

  const value = unwrap(expression)

  return (
    isBoolean(value) ||
    (value.type === 'Identifier' &&
      locals.fallbacksNamed(value.name, attribute.start).some(isBoolean))
  )
}

/** Whether an element may pass on an anchor: an anchor attribute, or a spread that may carry one. */
const forwards = (node: JSXOpeningElement): boolean =>
  node.attributes.some(
    (attribute) =>
      attribute.type === 'JSXSpreadAttribute' ||
      (attribute.name.type === 'JSXIdentifier' && isAnchorAttribute(attribute.name.name)),
  )

/** A `required` a wrapper fixes on an element whose anchor the check cannot read. */
export const requiredOverrides = (
  node: JSXOpeningElement,
  { attributes, carried }: ReadElement,
  locals: Locals,
  file: string,
  line: (start: number) => number,
): Problem[] =>
  carried !== undefined || !forwards(node)
    ? []
    : attributes
        .filter((attribute) => attribute.name === 'required' && fixes(attribute, locals))
        .map(({ start }) => ({ file, line: line(start), message: REQUIRED_ANCHOR }))
