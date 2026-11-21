/**
 * Every object a value may be, as far as its file says, the names read in their scopes
 * (`locals.ts`): an object written there, either branch of a conditional, either side of `||` or
 * `??` (a left that is nothing selects the right, so it adds no branch: for `??` only a nullish
 * one, since `false ?? x` is `false`) and the right of `&&` (or a nothing that may be `false`), the
 * one a constant holds (each one a variable that several `var`s or a parameter declare may hold), a
 * destructured name's key, each element of an array the file states for the `const` of a `for…of`
 * over it (where it can say every element and does not change the array), a member of such an
 * object (through the spreads it writes: a spread that lacks the key lets the scan go on before it,
 * a property whose key the file does not state or a spread the file cannot follow is one more
 * alternative, unknown, and the scan goes on before it too), or each object a function of the file
 * returns where it is called (each `return` of its own body, a bare one or a reachable end giving
 * nothing, an end no `return` or `throw` reaches being one a block or both arms of an `if` and
 * `else` end, `reachable-end.ts`; a `useCallback` hands its function on, a `useMemo` holds what its
 * function returns; an `async` function or a generator gives a Promise or an iterator, which is no
 * object the file writes: the call is one the file cannot say, beside the objects its returns
 * write, never nothing). A chain of names, calls and spreads is followed `DEPTH` steps, and given
 * up there (`DEEP`).
 */

import type { Expression, ObjectExpression, Super } from 'oxc-parser'

import { type Callable, hooked, isCallable } from './callable'
import type { Names } from './names'
import { statedKeyName, unwrap } from './values'

/** A chain the check stops following at `DEPTH`: unknown, and given up, so it is refused. */
export const DEEP = 'deep'

/**
 * One thing a value may be: an object; `null` for a nullish nothing (`null`, `undefined`, an absent
 * member, a function that returns none); `false` for a nothing that may not be nullish (`false`,
 * the left of `&&` where it is falsy), which `??` keeps; `undefined` for what the file cannot say
 * (a parameter, an import, a value built at runtime, a `0` or a `''`, a Promise or an iterator);
 * `DEEP`.
 */
export type Alternative = ObjectExpression | null | false | undefined | typeof DEEP

/** A nothing, nullish or not: spread, it supplies no prop. */
export const isNothing = (alternative: Alternative): alternative is null | false =>
  alternative === null || alternative === false

const isNullish = (value: Expression): boolean =>
  (value.type === 'Literal' && value.value === null) ||
  (value.type === 'Identifier' && value.name === 'undefined')

const isFalse = (value: Expression): boolean => value.type === 'Literal' && value.value === false

/** Unknown as a whole where one of them is unknown, given up where one is: else each of them. */
const settled = (alternatives: Alternative[]): Alternative[] =>
  alternatives.includes(DEEP)
    ? [DEEP]
    : alternatives.includes(undefined)
      ? [undefined]
      : alternatives

/** How many names, calls and spreads in a row are followed before giving up: no cycle runs on. */
export const DEPTH = 8

/** Follows a value, written at a place, to every object it may be (`Locals.objectsOf`). */
export function alternativesIn(names: Names): (node: Expression, at: number) => Alternative[] {
  const objectsOf = (node: Expression, at: number, depth = 0): Alternative[] => {
    const value = unwrap(node)
    const next = (expression: Expression): Alternative[] =>
      objectsOf(expression, expression.start, depth + 1)
    // An async function returns a Promise and a generator an iterator, whatever its `return`s
    // write, never nothing: the result is no object the file writes, so it is unknown, which keeps
    // it unfollowed and nothing it seems to supply certain. The objects its `return`s write stay
    // among the alternatives, for the anchor and the props the author put there to be read; a bare
    // `return`, a reachable end or a `null` adds no branch, as it would be a followed one.
    const resultOf = (fn: Callable): Alternative[] => {
      const written = names
        .returnedBy(fn)
        .flatMap((returned) => (returned === null ? [null] : next(returned)))

      return fn.async || fn.generator
        ? [undefined, ...written.filter((each) => !isNothing(each) && each !== undefined)]
        : written
    }
    /**
     * What each element of an array may be, for the variable of a `for…of` over it: the array
     * written there or held by a name of the file that the file does not change (`Names.changed`),
     * each element followed. A spread element, a hole or a value the file does not state as an
     * array may be anything.
     */
    const elementsOf = (iterated: Expression, level: number): Alternative[] => {
      const array = unwrap(iterated)

      if (array.type === 'ArrayExpression') {
        return array.elements.flatMap((element) =>
          element === null || element.type === 'SpreadElement'
            ? [undefined]
            : objectsOf(element, element.start, level + 1),
        )
      }

      if (array.type !== 'Identifier' || level >= DEPTH) {
        return [array.type === 'Identifier' ? DEEP : undefined]
      }

      const bound = names.boundTo(array.name, array.start)

      return bound.length === 0 || names.changed(array.name, array.start)
        ? [undefined]
        : bound.flatMap(({ value }) =>
            value === undefined ? [undefined] : elementsOf(value, level + 1),
          )
    }
    /**
     * Whether a name, written at `where`, or a member of one, is the variable of a `for…of` or a
     * name derived from it (destructured from it, `const { props } = row`, or an alias, `const r =
     * row`, at any remove): the body may guard which element reaches which use, so where one
     * element leaves it unknown, it is unknown as a whole (`settled`), the elements the file states
     * no alternatives of their own.
     */
    const looped = (node: Expression | Super, where: number, level = 0): boolean => {
      const written = node.type === 'Super' ? undefined : unwrap(node)

      if (written?.type === 'MemberExpression') {
        return looped(written.object, where, level)
      }

      return (
        written?.type === 'Identifier' &&
        level < DEPTH &&
        names
          .boundTo(written.name, where)
          .some(({ value: held, member }) =>
            member === undefined
              ? held !== undefined && looped(held, held.start, level + 1)
              : member.iterated === true || looped(member.object, member.object.start, level + 1),
          )
      )
    }
    /**
     * The alternatives of `key` in an object's properties, scanning back from `from` at nesting
     * `level`: a property with the key decides; a spread decides for each branch it may take that
     * has the key, and for a branch that lacks it the scan goes on with the properties before the
     * spread. A getter or a setter with the key is the key and leaves the member unknown. A
     * property whose key the file does not state (`[props.name]`), or a branch of a spread the file
     * cannot follow (`...props.extra`, an `async` helper's call), may be the key or not: the member
     * is unknown there and the scan goes on, so the properties before it stand as more
     * alternatives. `absent` says what holds where no property has the key: the scan of the object
     * that spread this one goes on, and only the outermost scan, of the member itself, says
     * nothing. Each object spread in turn is one level deeper, so no cycle runs on: at `DEPTH` the
     * scan is given up (`DEEP`).
     */
    const memberIn = (
      properties: ObjectExpression['properties'],
      from: number,
      key: string,
      level: number,
      absent: () => Alternative[],
    ): Alternative[] => {
      if (level >= DEPTH) {
        return [DEEP]
      }

      for (let index = from; index >= 0; index -= 1) {
        const property = properties[index]

        if (property?.type === 'SpreadElement') {
          const before = (): Alternative[] => memberIn(properties, index - 1, key, level, absent)

          return objectsOf(property.argument, property.start, level + 1).flatMap((branch) =>
            isNothing(branch)
              ? before()
              : branch === undefined || branch === DEEP
                ? [branch, ...before()]
                : memberIn(branch.properties, branch.properties.length - 1, key, level + 1, before),
          )
        }

        if (property !== undefined) {
          const named = statedKeyName(property.key, property.computed, names.constantNamed)

          if (named === undefined) {
            // It may be the key or not: the member is unknown, and the properties before it stand.
            return [undefined, ...memberIn(properties, index - 1, key, level, absent)]
          }

          if (named === key) {
            return property.kind === 'init'
              ? objectsOf(property.value, property.value.start, level + 1)
              : [undefined]
          }
        }
      }

      return absent()
    }
    const membersOf = (alternatives: readonly Alternative[], key: string): Alternative[] =>
      alternatives.flatMap((object) =>
        object === DEEP
          ? [DEEP]
          : isNothing(object) || object === undefined
            ? [undefined]
            : memberIn(object.properties, object.properties.length - 1, key, depth, () => [null]),
      )

    if (value.type === 'ObjectExpression') {
      return [value]
    }

    if (isNullish(value)) {
      return [null]
    }

    if (isFalse(value)) {
      return [false]
    }

    if (depth >= DEPTH) {
      return [DEEP]
    }

    switch (value.type) {
      case 'ConditionalExpression':
        return [...next(value.consequent), ...next(value.alternate)]
      case 'LogicalExpression': {
        // `&&` gives its left where that is falsy: a nothing that may be `false`, which `??` keeps.
        // A left of `??` that is nullish selects the right, as one of `||` that is any nothing;
        // a left the file cannot say may be either, and stays.
        const selects =
          value.operator === '||' ? isNothing : (each: Alternative): boolean => each === null

        return value.operator === '&&'
          ? [...next(value.right), false]
          : [...next(value.left).filter((each) => !selects(each)), ...next(value.right)]
      }
      case 'MemberExpression': {
        if (
          value.computed ||
          value.property.type !== 'Identifier' ||
          value.object.type === 'Super'
        ) {
          return [undefined]
        }

        const members = membersOf(objectsOf(value.object, at, depth + 1), value.property.name)

        return looped(value.object, at) ? settled(members) : members
      }
      case 'Identifier': {
        const bound = names.boundTo(value.name, at)

        // Each declaration that gives it a value may be the one.
        return bound.length === 0
          ? [undefined]
          : bound.flatMap(({ value: declared, member }): Alternative[] => {
              if (member !== undefined) {
                // A destructured name: the value destructured, or each element of the one a
                // `for…of` iterates, then each key down to it (`looped`).
                const part = member.path.reduce(
                  (alternatives, key) => membersOf(alternatives, key),
                  member.iterated === true
                    ? elementsOf(member.object, depth + 1)
                    : objectsOf(member.object, member.object.start, depth + 1),
                )

                return member.iterated === true || looped(member.object, member.object.start)
                  ? settled(part)
                  : part
              }

              const hook = declared === undefined ? undefined : hooked(declared)

              return declared === undefined || isCallable(declared)
                ? [undefined]
                : hook === undefined
                  ? next(declared)
                  : hook.calls
                    ? resultOf(hook.fn)
                    : [undefined]
            })
      }
      case 'CallExpression': {
        const bound = value.callee.type === 'Identifier' ? names.boundTo(value.callee.name, at) : []
        const calls = bound.map(({ value: declared }): Alternative[] => {
          const hook = declared === undefined ? undefined : hooked(declared)
          const fn =
            declared !== undefined && isCallable(declared)
              ? declared
              : hook !== undefined && !hook.calls
                ? hook.fn
                : undefined

          return fn === undefined ? [undefined] : resultOf(fn)
        })

        return calls.length === 0 ? [undefined] : calls.flat()
      }
      default:
        return [undefined]
    }
  }

  return (node, at) => objectsOf(node, at)
}
