/**
 * What the kit takes from the contract's field facts, which the sources leave to it: the words every
 * such refusal ends with, and a `required` written as a literal (bare, `{true}`, `{false}`, or one a
 * spread supplies) on an element whose anchor the check cannot read, a wrapper's inner field that
 * overrides the fact the kit takes. A name, a member or an expression passed on is let by, as the
 * kit's own `required ?? facts?.required` is.
 */

import type { Problem } from '../files'

import { type ElementAttribute, expressionOf } from './element'

export const LEFT_TO_THE_KIT = "the kit takes it from the contract's field facts; leave it out"

export const REQUIRED_ANCHOR = `required on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

/** Whether a prop is written as a boolean literal: bare, `{true}` or `{false}`, or a spread's. */
const writesLiteral = (attribute: ElementAttribute): boolean => {
  const expression = expressionOf(attribute)

  return expression === undefined
    ? attribute.value === null
    : expression.type === 'Literal' && typeof expression.value === 'boolean'
}

/** A `required` written as a literal on an element whose anchor the check cannot read. */
export const requiredOverrides = (
  attributes: readonly ElementAttribute[],
  file: string,
  line: (start: number) => number,
): Problem[] =>
  attributes
    .filter((attribute) => attribute.name === 'required' && writesLiteral(attribute))
    .map(({ start }) => ({ file, line: line(start), message: REQUIRED_ANCHOR }))
