/**
 * What the kit takes from the contract's field facts, which the sources leave to it: the words every
 * such refusal ends with, and a `required` a wrapper fixes on the field it passes an anchor to. The
 * kit lets a `required` written on its field win over the fact, so on an element that may pass on an
 * anchor the check cannot read (an anchor attribute, written or a followed spread's, or a spread the
 * file cannot follow), a `required` that may fix the value is refused: a boolean literal (bare,
 * `{true}`, `{false}`, behind a type assertion, or one a spread supplies), a name a `const` or its
 * own default gives one, or a `??`, `||`, `&&` or conditional with one on a side
 * (`({ required = false }) => <Input required={required} … />`, `required={props.required ?? false}`).
 * A value that can be none of these is let by, as the kit's own `required ?? facts?.required` is,
 * and an element that passes on no anchor at all is no wrapper's field.
 */

import type { Expression } from 'oxc-parser'

import type { Problem } from '../files'

import { DEPTH } from './alternatives'
import { type ElementAttribute, expressionOf, isAnchorAttribute, type ReadElement } from './element'
import type { Locals } from './locals'
import { unwrap } from './values'

export const LEFT_TO_THE_KIT = "the kit takes it from the contract's field facts; leave it out"

export const REQUIRED_ANCHOR = `required on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

/**
 * Whether a value may be a boolean the wrapper fixes: a literal, under the wrappers that change
 * nothing at runtime; a name a `const` or its own default gives one, read where the name is written;
 * either side of a `??`, a `||` or a `&&`; either branch of a conditional.
 */
const fixes = (node: Expression, locals: Locals, depth = 0): boolean => {
  const value = unwrap(node)

  if (depth >= DEPTH) {
    return false
  }

  switch (value.type) {
    case 'Literal':
      return typeof value.value === 'boolean'
    case 'Identifier': {
      const declared = locals.valueNamed(value.name, value.start)

      return [
        ...locals.fallbacksNamed(value.name, value.start),
        ...(declared ? [declared] : []),
      ].some((one) => fixes(one, locals, depth + 1))
    }
    case 'LogicalExpression':
      return fixes(value.left, locals, depth + 1) || fixes(value.right, locals, depth + 1)
    case 'ConditionalExpression':
      return fixes(value.consequent, locals, depth + 1) || fixes(value.alternate, locals, depth + 1)
    default:
      return false
  }
}

/** Whether a `required` fixes the field's value: bare, or a value that may be a fixed boolean. */
const fixedBy = (attribute: ElementAttribute, locals: Locals): boolean => {
  const expression = expressionOf(attribute)

  return expression === undefined ? attribute.value === null : fixes(expression, locals)
}

/**
 * Whether an element may pass on an anchor the check cannot read: an anchor attribute, written or
 * a followed spread's, or a spread the file cannot follow, which may carry one.
 */
const forwards = ({ attributes, unfollowed }: ReadElement): boolean =>
  unfollowed || attributes.some(({ name }) => isAnchorAttribute(name))

/** A `required` a wrapper fixes on an element whose anchor the check cannot read. */
export const requiredOverrides = (
  element: ReadElement,
  locals: Locals,
  file: string,
  line: (start: number) => number,
): Problem[] =>
  element.carried !== undefined || !forwards(element)
    ? []
    : element.attributes
        .filter((attribute) => attribute.name === 'required' && fixedBy(attribute, locals))
        .map(({ start }) => ({ file, line: line(start), message: REQUIRED_ANCHOR }))
