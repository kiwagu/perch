/**
 * The event a `disabled={!props.can(<event>)}` asks its machine about, as far as its file says
 * (`locals.ts`), read where the expression is written, so a helper's own constant resolves in the
 * helper: the `type` each object its argument may be ends up with, in the order the object writes
 * it (a later `type`, or a spread that sets one, overrides an earlier one), `testIdFor()` of two
 * literals as that type included; a spread the file cannot follow is the event's data (a form's
 * values, `{ type: '<anchor>', ...values }`), never its type. An argument the file cannot follow, a
 * `type` it cannot read, or two alternatives that name different events leave it unread. The facets check holds it to
 * the event the control itself sends, its anchor, so a copied `can(reset)` on the revoke button is
 * caught.
 */

import type { Expression, ObjectExpression } from 'oxc-parser'

import { type Alternative, DEPTH } from './alternatives'
import type { Locals } from './locals'
import { derivedAnchorOf, keyName, staticText, unwrap } from './values'

/** `can` or `props.can`, the machine's question as the facets idiom writes it. */
const isCan = (callee: Expression): boolean =>
  (callee.type === 'Identifier' && callee.name === 'can') ||
  (callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'props' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'can')

/** What an event's `type` may end up as: a name, `null` unread, `undefined` where none is set. */
type Typed = string | null | undefined

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

  const typesOf = (alternatives: readonly Alternative[], depth: number): Typed[] =>
    alternatives.flatMap((object): Typed[] =>
      object === undefined ? [null] : object === null ? [undefined] : typesIn(object, depth),
    )
  const typesIn = (object: ObjectExpression, depth: number): Typed[] =>
    depth >= DEPTH
      ? [null]
      : object.properties.reduce<Typed[]>(
          (now, property) => {
            if (property.type === 'SpreadElement') {
              // A spread the file cannot follow is the event's data (a form's values), never its type.
              return locals
                .objectsOf(property.argument, property.start)
                .flatMap((object) =>
                  object === undefined || object === null
                    ? now
                    : typesIn(object, depth + 1).flatMap((type) =>
                        type === undefined ? now : [type],
                      ),
                )
            }

            const key = keyName(property.key, property.computed)

            if (key === undefined) {
              // A computed key the file cannot read may set the type as well.
              return [null]
            }

            return key !== 'type'
              ? now
              : property.kind !== 'init'
                ? [null]
                : [staticText(property.value) ?? derivedAnchorOf(property.value)?.anchor ?? null]
          },
          [undefined],
        )

  const types = new Set(typesOf(locals.objectsOf(argument, at), 0))
  const [event] = types

  return types.size === 1 && typeof event === 'string' ? event : undefined
}
