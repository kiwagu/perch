/**
 * What the kit takes from the contract's field facts, which the sources leave to it: the words every
 * such refusal ends with, and a `required` a wrapper fixes on the field it passes an anchor to. The
 * kit lets a `required` written on its field win over the fact, so on an element that may pass on an
 * anchor the check cannot read (an anchor attribute, written or a followed spread's, or a spread the
 * file cannot follow), a `required` that may fix the value is refused: a boolean literal (bare,
 * `{true}`, `{false}`, behind a type assertion, or one a spread supplies), a name a `const` or its
 * own default gives one, a member of an object the file states that may be one, or a `??`, `||`,
 * `&&` or conditional that can return one (`({ required = false }) => <Input required={required}
 * … />`, `required={props.required ?? false}`, `required={props.required ?? defaults.required}`).
 * A value that can be none of these is let by, as the kit's own `required ?? facts?.required` is,
 * and an element that passes on no anchor at all is no wrapper's field.
 */

import type { Expression, MemberExpression, PropertyKey } from 'oxc-parser'

import type { Problem } from '../files'

import { DEPTH } from './alternatives'
import { type ElementAttribute, expressionOf, isAnchorAttribute, type ReadElement } from './element'
import type { Locals } from './locals'
import { suppliedBy } from './spreads'
import { statedKeyName, unwrap } from './values'

export const LEFT_TO_THE_KIT = "the kit takes it from the contract's field facts; leave it out"

export const REQUIRED_ANCHOR = `required on an element that carries no anchor as a literal or as testIdFor() of two literals: ${LEFT_TO_THE_KIT}`

/** The name a member reads, where the file states it (`defaults.required`, `defaults['required']`). */
const keyOf = (node: MemberExpression, locals: Locals): string | undefined =>
  node.property.type === 'PrivateIdentifier'
    ? undefined
    : statedKeyName(node.property as PropertyKey, node.computed, locals.constantNamed)

/** What a member of an object the file states may be: the values its props of that name have. */
const membersOf = (
  node: MemberExpression,
  locals: Locals,
): { readonly values: readonly Expression[]; readonly surely: boolean } => {
  const key = keyOf(node, locals)

  if (key === undefined || node.object.type === 'Super') {
    return { values: [], surely: false }
  }

  const supplied = suppliedBy(locals, node.object, node.object.start)
  const values = supplied.props.filter(({ name }) => name === key).map(({ value }) => value)

  return { values, surely: supplied.followed && supplied.certain.has(key) && values.length === 1 }
}

/**
 * The one boolean a value surely is, where the file says so: a literal, under the wrappers that
 * change nothing at runtime, or a `const` or a member of an object the file states that surely is.
 */
const known = (node: Expression, locals: Locals, depth = 0): boolean | undefined => {
  const value = unwrap(node)

  if (depth >= DEPTH) {
    return undefined
  }

  if (value.type === 'Literal') {
    return typeof value.value === 'boolean' ? value.value : undefined
  }

  const one =
    value.type === 'Identifier'
      ? locals.constantNamed(value.name, value.start)
      : value.type === 'MemberExpression'
        ? membersOf(value, locals)
        : undefined
  const sole = one === undefined || 'type' in one ? one : one.surely ? one.values[0] : undefined

  return sole === undefined ? undefined : known(sole, locals, depth + 1)
}

/**
 * Whether a value may be a boolean the wrapper fixes: one it surely is (`known`); a name its own
 * default or its `const` may make one, read where the name is written; a member of an object the
 * file states that may be one; the operand of a `??`, a `||` or a `&&` that can be its result (a
 * known left operand decides which: `false || facts?.required` is the fact); a branch of a
 * conditional that can be taken.
 */
const fixes = (node: Expression, locals: Locals, depth = 0): boolean => {
  const value = unwrap(node)
  const next = (one: Expression): boolean => fixes(one, locals, depth + 1)

  if (depth >= DEPTH) {
    return false
  }

  if (known(value, locals) !== undefined) {
    return true
  }

  switch (value.type) {
    case 'Identifier': {
      const declared = locals.constantNamed(value.name, value.start)

      return [
        ...locals.fallbacksNamed(value.name, value.start),
        ...(declared ? [declared] : []),
      ].some(next)
    }
    case 'MemberExpression':
      return membersOf(value, locals).values.some(next)
    case 'LogicalExpression': {
      const left = known(value.left, locals)
      const decided =
        (value.operator === '||' && left === false) || (value.operator === '&&' && left === true)

      return decided ? next(value.right) : next(value.left) || next(value.right)
    }
    case 'ConditionalExpression': {
      const test = known(value.test, locals)

      return (test !== false && next(value.consequent)) || (test !== true && next(value.alternate))
    }
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
