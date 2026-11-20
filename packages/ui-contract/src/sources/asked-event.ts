/**
 * The event a `disabled={!props.can(<event>)}` asks its machine about, as far as its file says
 * (`locals.ts`), read where the expression is written, so a helper's own constant resolves in the
 * helper: the `type` each object its argument may be ends up with, in the order the object writes
 * it (a later `type`, or a spread that sets one, overrides an earlier one), the `type` read as an
 * element's anchor is (`anchorIn`, `element.ts`): a literal, `testIdFor()` of two literals, or a
 * `<NAME>_TEST_ID` constant that holds either, or `testIdFor()` of such a constant and a literal
 * suffix. Only a `const` of the file holds one, resolved where the `type` is written, however far
 * an alias or a base goes: a name a `let`, a `var` or a parameter binds may hold another by the
 * time the event is sent, and leaves it unread. A spread the file cannot follow is the data of an
 * event that writes its own `type` (a form's values, `{ type: '<anchor>', ...values }`), or of any
 * event where the file writes a type for it that cannot carry `type` (`{ ...submit, ...draft }`,
 * `draft` of an interface of the file without one, `Locals.declaredTypeOf`, `declared-type.ts`).
 * One it writes a type for that can carry `type` (a `type` member, a string index signature) may
 * replace the type of an event that writes its own, so the event is unread, unless the file says
 * which events that member allows (`allowed-values.ts`): string literal types, and `typeof
 * <name>.type` of an `as const` object of the file, whose `type` is read as here. Those join the
 * types the event has before the spread, an optional member being absent, and the event is read
 * where they are one event. One the file says nothing of may be the type of an event that writes
 * none. An argument the file cannot follow, a `type` it cannot read (a `<NAME>_TEST_ID` the file
 * does not declare, an import, included), or two alternatives that name different events leave it
 * unread. The question itself is read from the tree: one negated call of `can` or `props.can` with
 * one argument, whatever that argument nests. The facets check holds it to the event the control
 * itself sends, its anchor, so a copied `can(reset)` on the revoke button is caught.
 */

import type { Expression, ObjectExpression, SpreadElement } from 'oxc-parser'

import { type AllowedValue, allowedValues } from './allowed-values'
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

/** Whether `node` is `<value> as const`, in parentheses or a `satisfies`: it keeps its literals. */
const isConstAssertion = (node: Expression): boolean =>
  node.type === 'ParenthesizedExpression' || node.type === 'TSSatisfiesExpression'
    ? isConstAssertion(node.expression)
    : node.type === 'TSAsExpression' &&
      node.typeAnnotation.type === 'TSTypeReference' &&
      node.typeAnnotation.typeName.type === 'Identifier' &&
      node.typeAnnotation.typeName.name === 'const'

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
  /**
   * Whether a spread the file cannot follow is data of the event: not where the file writes a type
   * for it that can carry `type`, which may replace the event's; otherwise where the file writes
   * one that cannot, or the object writes its own `type`.
   */
  const isData = (object: ObjectExpression, spread: SpreadElement): boolean => {
    const declared = locals.declaredTypeOf(spread.argument, spread.start)

    if (declared !== undefined && locals.types.canCarry(declared, 'type')) {
      return false
    }

    return typed(object) || (declared !== undefined && locals.types.cannotCarry(declared, 'type'))
  }
  /**
   * The events `typeof <name>.type` says, where `name` is a `const` of the file that is `as const`,
   * so the `type` it is written with is what the type allows, and the question reads it as one.
   */
  const queriedTypes = (
    { name, at }: Extract<AllowedValue, { kind: 'query' }>,
    depth: number,
  ): string[] | undefined => {
    const declared = locals.constantNamed(name, at)

    if (declared === undefined || !isConstAssertion(declared)) {
      return undefined
    }

    const types = typesOf(locals.objectsOf(declared, declared.start), depth + 1)

    return types.every((type): type is string => typeof type === 'string') ? types : undefined
  }
  /**
   * The events the file's type for a spread it cannot follow says its `type` may be: the string
   * literals its `type` member allows and what each `typeof <name>.type` it names reads as; none
   * where the file does not say, as for a `string`, an import or an index.
   */
  const spreadTypes = (spread: SpreadElement, depth: number): string[] | undefined => {
    const declared = locals.declaredTypeOf(spread.argument, spread.start)
    const member = declared === undefined ? undefined : locals.types.memberOf(declared, 'type')
    const allowed = member === undefined ? undefined : allowedValues(member, 'type')

    if (allowed === undefined) {
      return undefined
    }

    const events = allowed.map((value) =>
      value.kind === 'literal' ? [value.text] : queriedTypes(value, depth),
    )

    return events.every((each): each is string[] => each !== undefined) ? events.flat() : undefined
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
              return locals
                .objectsOf(property.argument, property.start)
                .flatMap((branch): Typed[] => {
                  if (branch === null) {
                    return now
                  }

                  // A spread the file cannot follow is the data of an event that writes its own
                  // `type` (`{ type: '<anchor>', ...values }`), or where the file writes a type for
                  // it that cannot carry one; where the file says which events its `type` may be,
                  // they join the types the event has so far, an optional member being absent;
                  // otherwise it may be the type.
                  if (branch === undefined) {
                    if (isData(object, property)) {
                      return now
                    }

                    const set = spreadTypes(property, depth)

                    return set === undefined ? [null] : now.concat(set)
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
                : [
                    anchorIn(locals, property.value, property.value.start, locals.constantNamed)
                      ?.anchor ?? null,
                  ]
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
