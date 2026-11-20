/**
 * The event a `disabled={!props.can(<event>)}` asks its machine about, as far as its file says
 * (`locals.ts`), read where the expression is written, so a helper's own constant resolves in the
 * helper: the `type` each object its argument may be ends up with, in the order the object writes
 * it (a later `type`, or a spread that sets one, overrides an earlier one), the `type` read as an
 * element's anchor is (`anchorIn`, `element.ts`): a literal, `testIdFor()` of two literals, or a
 * `<NAME>_TEST_ID` constant of the file that holds either, or `testIdFor()` of such a constant and
 * a literal suffix, the constant resolved where the `type` is written; a spread the file cannot
 * follow is the data of an event that writes its own `type` (a form's values,
 * `{ type: '<anchor>', ...values }`), and may be the type of one that does not. An argument the
 * file cannot follow, a `type` it cannot read (a `<NAME>_TEST_ID` the file does not declare, an
 * import, included), or two alternatives that name different events leave it unread. The question
 * itself is read from the tree: one negated call of `can` or `props.can` with one argument,
 * whatever that argument nests. The facets check holds it to the event the control itself sends,
 * its anchor, so a copied `can(reset)` on the revoke button is caught.
 */

import type { Expression, ObjectExpression } from 'oxc-parser'

import { type Alternative, DEPTH } from './alternatives'
import { anchorIn } from './element'
import type { Locals } from './locals'
import { keyName, unwrap } from './values'

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

/** A `disabled` as the facets check reads it: whether it is one question, and the event it asks. */
export interface Question {
  /** One negated question to the machine with nothing beside it: `!can(<one argument>)`. */
  readonly question: boolean
  /** The one event it asks about, where its file says; none when unread or several. */
  readonly asks?: string
}

export function questionOf(locals: Locals, written: Expression): Question {
  const negated = unwrap(written)
  const call =
    negated.type === 'UnaryExpression' && negated.operator === '!'
      ? unwrap(negated.argument)
      : undefined

  if (call?.type !== 'CallExpression' || call.callee.type === 'Super' || !isCan(call.callee)) {
    return { question: false }
  }

  const [argument, ...more] = call.arguments

  if (argument === undefined || argument.type === 'SpreadElement' || more.length > 0) {
    return { question: false }
  }

  /** Whether an object writes its own `type`: then a spread it cannot follow is its data. */
  const typed = (object: ObjectExpression): boolean =>
    object.properties.some(
      (property) =>
        property.type === 'Property' && keyName(property.key, property.computed) === 'type',
    )
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
              return locals
                .objectsOf(property.argument, property.start)
                .flatMap((branch): Typed[] => {
                  if (branch === null) {
                    return now
                  }

                  // A spread the file cannot follow is the data of an event that writes its own
                  // `type` (`{ type: '<anchor>', ...values }`); of one that does not, it may be the type.
                  if (branch === undefined) {
                    return typed(object) ? now : [null]
                  }

                  return typesIn(branch, depth + 1).flatMap((type) =>
                    type === undefined ? now : [type],
                  )
                })
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
                : [anchorIn(locals, property.value, property.value.start)?.anchor ?? null]
          },
          [undefined],
        )

  const types = new Set(typesOf(locals.objectsOf(argument, argument.start), 0))
  const [event] = types

  return {
    question: true,
    ...(types.size === 1 && typeof event === 'string' ? { asks: event } : {}),
  }
}
