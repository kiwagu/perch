/**
 * Every object a value may be, as far as its file says, the names read in their scopes
 * (`locals.ts`): an object written there, either branch of a conditional, either side of `||` or
 * `??` (a left that is nothing selects the right, so it adds no branch) and the right of `&&` (or
 * nothing), the one a constant holds (each a name two declarations of one scope bind may hold), a
 * destructured name's key,
 * each element of an array the file states for the variable of a `for…of` over it, a
 * member of such an object (through the spreads it writes, at any depth: a spread that lacks the
 * key lets the scan go on before it, a property whose key the file does not state or a spread the
 * file cannot follow is one more alternative, unknown, and the scan goes on before it too), or each
 * object a function of the file returns where it is called (each `return` of its own body, a bare
 * one or a reachable end giving nothing, an end no `return` or `throw` reaches being one a block or
 * both arms of an `if` and `else` end, `reachable-end.ts`; a `useCallback` hands its function on, a
 * `useMemo` holds what its function returns; an `async` function or a generator gives a Promise or
 * an iterator, which is no object the file writes: the call is one the file cannot say, beside the
 * objects its returns write, never nothing).
 */

import type {
  ArrowFunctionExpression,
  Expression,
  Function as FunctionNode,
  ObjectExpression,
} from 'oxc-parser'

import { statedKeyName, unwrap } from './values'

/**
 * One thing a value may be: an object, `null` for nothing (`null`, `false`, `undefined`, a function
 * that returns none), `undefined` for what the file cannot say (a parameter, an import, a value
 * built at runtime, a Promise or an iterator, a chain past `DEPTH`).
 */
export type Alternative = ObjectExpression | null | undefined

const isNothing = (value: Expression): boolean =>
  (value.type === 'Literal' && (value.value === null || value.value === false)) ||
  (value.type === 'Identifier' && value.name === 'undefined')

/** How many names, calls and spreads in a row are followed before giving up: no cycle runs on. */
export const DEPTH = 8

export type Callable = ArrowFunctionExpression | FunctionNode

export const isCallable = (value: Expression): value is Callable =>
  value.type === 'ArrowFunctionExpression' ||
  value.type === 'FunctionExpression' ||
  value.type === 'FunctionDeclaration'

/**
 * A name bound to a part of another value: a destructured name, the value destructured and the
 * keys down to it; the variable of a `for…of`, each element of the value it iterates (`iterated`),
 * then the keys its head destructures.
 */
export interface Member {
  readonly object: Expression
  readonly path: readonly string[]
  readonly iterated?: true
}

/** What a declaration binds a name to: the value it declares, or the part of one (`Member`). */
export interface Bound {
  readonly value?: Expression
  readonly member?: Member
}

/** What the scopes of a file say of a name, for following a value. */
export interface Names {
  /** What a name, written at a place, is bound to: each declaration of the scope that binds it. */
  boundTo(name: string, at: number): readonly Bound[]
  /** The value of a name a `const` declares, as `Locals.constantNamed`. */
  constantNamed(name: string, at: number): Expression | undefined
  returnedBy(fn: Callable): Array<Expression | null>
}

/** Follows a value, written at a place, to every object it may be (`Locals.objectsOf`). */
export function alternativesIn(names: Names): (node: Expression, at: number) => Alternative[] {
  /** A hook that hands its function on (`useCallback`) or calls it (`useMemo`), if `node` is one. */
  const hooked = (
    node: Expression,
  ): { readonly calls: boolean; readonly fn: Callable } | undefined => {
    const call = unwrap(node)

    if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier') {
      return undefined
    }

    const hook = call.callee.name
    const [first] = call.arguments
    const fn = first === undefined || first.type === 'SpreadElement' ? undefined : unwrap(first)

    return (hook === 'useCallback' || hook === 'useMemo') && fn !== undefined && isCallable(fn)
      ? { calls: hook === 'useMemo', fn }
      : undefined
  }

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
        ? [
            undefined,
            ...written.filter((alternative) => alternative !== null && alternative !== undefined),
          ]
        : written
    }
    /**
     * What each element of an array may be, for the variable of a `for…of` over it: the array
     * written there or held by a name of the file, each element followed. A spread element, a hole
     * or a value the file does not state as an array may be anything: unknown.
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

      const bound =
        array.type === 'Identifier' && level < DEPTH ? names.boundTo(array.name, array.start) : []

      return bound.length === 0
        ? [undefined]
        : bound.flatMap(({ value }) =>
            value === undefined ? [undefined] : elementsOf(value, level + 1),
          )
    }
    /**
     * The alternatives of `key` in an object's properties, scanning back from `from` at nesting
     * `level`: a property with the key decides; a spread decides for each branch it may take that
     * has the key, and for a branch that lacks it, at any depth, the scan goes on with the
     * properties before the spread. A getter or a setter with the key is the key and leaves the
     * member unknown. A property whose key the file does not state (`[props.name]`), or a branch of
     * a spread the file cannot follow (`...props.extra`, an `async` helper's call), may be the key
     * or not: the member is unknown there and the scan goes on, so the properties before it stand
     * as more alternatives. `absent` says what holds where no property has the key: the scan of
     * the object that spread this one goes on, and only the outermost scan, of the member itself,
     * says nothing. Each object spread in turn is one level deeper, so no cycle runs on: at
     * `DEPTH` the member is unknown.
     */
    const memberIn = (
      properties: ObjectExpression['properties'],
      from: number,
      key: string,
      level: number,
      absent: () => Alternative[],
    ): Alternative[] => {
      if (level >= DEPTH) {
        return [undefined]
      }

      for (let index = from; index >= 0; index -= 1) {
        const property = properties[index]

        if (property?.type === 'SpreadElement') {
          const before = (): Alternative[] => memberIn(properties, index - 1, key, level, absent)

          return objectsOf(property.argument, property.start, level + 1).flatMap((branch) =>
            branch === undefined
              ? [undefined, ...before()]
              : branch === null
                ? before()
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
        object === null || object === undefined
          ? [undefined]
          : memberIn(object.properties, object.properties.length - 1, key, depth, () => [null]),
      )

    if (value.type === 'ObjectExpression') {
      return [value]
    }

    if (isNothing(value)) {
      return [null]
    }

    if (depth >= DEPTH) {
      return [undefined]
    }

    switch (value.type) {
      case 'ConditionalExpression':
        return [...next(value.consequent), ...next(value.alternate)]
      case 'LogicalExpression':
        // A left of `||` or `??` that is nothing selects the right, so it is no branch of its own
        // (a `false` before `??` is taken so too: nothing here tells it from `null`); a left the
        // file cannot say may be either, and stays.
        return value.operator === '&&'
          ? [...next(value.right), null]
          : [
              ...next(value.left).filter((alternative) => alternative !== null),
              ...next(value.right),
            ]
      case 'MemberExpression': {
        if (
          value.computed ||
          value.property.type !== 'Identifier' ||
          value.object.type === 'Super'
        ) {
          return [undefined]
        }

        return membersOf(objectsOf(value.object, at, depth + 1), value.property.name)
      }
      case 'Identifier': {
        const bound = names.boundTo(value.name, at)

        // Each declaration the scope that binds it makes may be the one.
        return bound.length === 0
          ? [undefined]
          : bound.flatMap(({ value: declared, member }): Alternative[] => {
              if (member !== undefined) {
                // A destructured name: the value destructured, or each element of the one a
                // `for…of` iterates, then each key down to it.
                return member.path.reduce(
                  (alternatives, key) => membersOf(alternatives, key),
                  member.iterated === true
                    ? elementsOf(member.object, depth + 1)
                    : objectsOf(member.object, member.object.start, depth + 1),
                )
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
