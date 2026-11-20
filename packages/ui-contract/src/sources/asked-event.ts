/**
 * The event a `disabled={!props.can(<event>)}` asks its machine about, as far as its file says
 * (`locals.ts`): the `type` of the object its argument is, written there (`{ type: '<anchor>' }`)
 * or held by a constant of the file (`const revoke = { type: '<anchor>' } as const`), a
 * `testIdFor()` of two literals as that type included. The facets check holds it to the event the
 * control itself sends, its anchor, so a copied `can(reset)` on the revoke button is caught.
 */

import type { Expression } from 'oxc-parser'

import type { Locals } from './locals'
import { derivedAnchorOf, keyName, staticText, unwrap } from './values'

/** `can` or `<anything>.can`, the machine's question. */
const isCan = (callee: Expression): boolean =>
  (callee.type === 'Identifier' && callee.name === 'can') ||
  (callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'can')

/** The one event `!can(<argument>)` asks about; none when it cannot be read, or reads as several. */
export function askedEventOf(locals: Locals, written: Expression, at: number): string | undefined {
  const negated = unwrap(written)
  const call =
    negated.type === 'UnaryExpression' && negated.operator === '!'
      ? unwrap(negated.argument)
      : undefined

  if (call?.type !== 'CallExpression' || call.callee.type === 'Super' || !isCan(call.callee)) {
    return undefined
  }

  const [argument] = call.arguments

  if (argument === undefined || argument.type === 'SpreadElement') {
    return undefined
  }

  const types = locals
    .objectsOf(argument, at)
    .flatMap((object) =>
      object.properties.flatMap((property) =>
        property.type === 'Property' &&
        property.kind === 'init' &&
        keyName(property.key, property.computed) === 'type'
          ? [staticText(property.value) ?? derivedAnchorOf(property.value)?.anchor]
          : [],
      ),
    )
  const [event] = types

  return types.length > 0 && types.every((type) => type !== undefined && type === event)
    ? event
    : undefined
}
