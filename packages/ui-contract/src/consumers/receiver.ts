/**
 * The anchor a `toHaveAttribute` assertion is made on, as the consumers check pairs what it
 * asserts: the matcher is called on `expect(<receiver>)`, `.not` included, and the receiver is
 * a call chain whose last `getByTestId('<anchor>')` locates the element itself, every step
 * after it only narrowing what it found (`first`, `last`, `nth`, `filter`, `and`). Any other
 * receiver names no anchor the check can follow: a variable, a helper, a `getByTestId` of
 * anything but a string, a `locator` or another query that reaches into the element.
 */

import type { CallExpression, Expression } from 'oxc-parser'

import { unwrap } from '../sources'

import { foldedText } from './pieces'

/** The steps of a locator chain that keep to the elements the step before them found. */
const NARROWING = new Set(['first', 'last', 'nth', 'filter', 'and'])

const EXPECT = 'expect'

const NOT = 'not'

/** The name a call is made by: a function's, or a method's written as `.name`. */
export function calleeName(call: CallExpression): string | undefined {
  const { callee } = call

  return callee.type === 'Identifier'
    ? callee.name
    : callee.type === 'MemberExpression' && !callee.computed
      ? callee.property.name
      : undefined
}

/** `expect(<receiver>)` as a subject of a matcher: its receiver, or undefined for any other. */
function receiverOf(subject: Expression): Expression | undefined {
  const value = unwrap(subject)

  if (
    value.type !== 'CallExpression' ||
    value.callee.type !== 'Identifier' ||
    value.callee.name !== EXPECT
  ) {
    return undefined
  }

  const [receiver] = value.arguments

  return receiver?.type === 'SpreadElement' ? undefined : receiver
}

/** The anchor of the last `getByTestId` of a locator chain, through the steps that narrow it. */
function chainAnchor(node: Expression): string | undefined {
  const value = unwrap(node)

  if (value.type !== 'CallExpression') {
    return undefined
  }

  const name = calleeName(value)

  if (name === 'getByTestId') {
    return foldedText(value.arguments[0])
  }

  return name !== undefined && NARROWING.has(name) && value.callee.type === 'MemberExpression'
    ? chainAnchor(value.callee.object)
    : undefined
}

/** The anchor of the element a matcher such as `toHaveAttribute` asserts on, if the check can read it. */
export function assertedAnchor(matcher: CallExpression): string | undefined {
  const callee = unwrap(matcher.callee)

  if (callee.type !== 'MemberExpression') {
    return undefined
  }

  const subject = unwrap(callee.object)
  const negated =
    subject.type === 'MemberExpression' && !subject.computed && subject.property.name === NOT
  const receiver = receiverOf(negated ? subject.object : subject)

  return receiver === undefined ? undefined : chainAnchor(receiver)
}
