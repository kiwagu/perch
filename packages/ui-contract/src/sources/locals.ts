/**
 * What a source file's names stand for, as far as the file itself says: the value a constant or a
 * function is declared with, read in the scope that declares it, so a name resolves as it does at
 * runtime (an inner declaration, a parameter or a destructured name hides an outer one), and every
 * object a value may be (`objectsOf`), for a spread's props (`spreads.ts`) and the event `can()`
 * names (`asked-event.ts`). A name of another file, or a value built at runtime, is an alternative
 * the file cannot follow, which each reader decides about itself.
 */

import type {
  ArrowFunctionExpression,
  Expression,
  Function as FunctionNode,
  ObjectExpression,
  ParamPattern,
  Program,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { namesIn } from './binding-names'
import { keyName, unwrap } from './values'

/** A range of the source, `[start, end)`. */
interface Span {
  readonly start: number
  readonly end: number
}

/** A name a scope binds, with the value the file declares it with; none for a parameter. */
interface Binding {
  readonly name: string
  /** Where it is declared; its scope is the innermost scope around this place. */
  readonly at: Span
  readonly value?: Expression
}

export interface Locals {
  /** What `name`, written at `at`, is declared with in the file (a function too), if it says. */
  valueNamed(name: string, at: number): Expression | undefined
  /** Whether the file binds `name` where it is written at `at`: declared, or a parameter. */
  declares(name: string, at: number): boolean
  /**
   * What `node`, written at `at`, may be, each alternative once: an object written there, either
   * branch of a conditional, either side of `||` or `??` and the right of `&&` (or nothing), the
   * one a constant holds, a member of such an object, or each one a function of the file returns
   * where it is called (an arrow's expression, each `return` of its own body; a `useCallback` hands
   * its function on, a `useMemo` holds what its function returns).
   */
  objectsOf(node: Expression, at: number): Alternative[]
}

/**
 * One thing a value may be: an object, `null` for nothing (`null`, `false`, `undefined`, a function
 * that returns none), `undefined` for what the file cannot say (a parameter, an import, a value
 * built at runtime, a chain past `DEPTH`).
 */
export type Alternative = ObjectExpression | null | undefined

const isNothing = (value: Expression): boolean =>
  (value.type === 'Literal' && (value.value === null || value.value === false)) ||
  (value.type === 'Identifier' && value.name === 'undefined')

/** How many names, calls and spreads in a row are followed before giving up: no cycle runs on. */
export const DEPTH = 8

type Callable = ArrowFunctionExpression | FunctionNode

const isCallable = (value: Expression): value is Callable =>
  value.type === 'ArrowFunctionExpression' ||
  value.type === 'FunctionExpression' ||
  value.type === 'FunctionDeclaration'

const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

const sizeOf = ({ start, end }: Span): number => end - start

export function localsOf(program: Program): Locals {
  const scopes: Span[] = [FILE]
  const functions: Span[] = []
  const bindings: Binding[] = []
  const returns: Array<{ readonly at: number; readonly argument: Expression }> = []
  const parameters = (node: Span & { readonly params: readonly ParamPattern[] }): void => {
    scopes.push(node)
    functions.push(node)
    bindings.push(
      ...node.params
        .flatMap(namesIn)
        .map((name) => ({ name, at: { start: node.start, end: node.start } })),
    )
  }

  new Visitor({
    BlockStatement: (node) => {
      scopes.push(node)
    },
    ReturnStatement: (node) => {
      if (node.argument !== null) {
        returns.push({ at: node.start, argument: node.argument })
      }
    },
    ArrowFunctionExpression: parameters,
    FunctionExpression: parameters,
    FunctionDeclaration: (node) => {
      parameters(node)

      if (node.id !== null) {
        bindings.push({ name: node.id.name, at: node, value: node })
      }
    },
    VariableDeclarator: (node) => {
      const at = { start: node.start, end: node.end }

      if (node.id.type === 'Identifier') {
        bindings.push({
          name: node.id.name,
          at,
          ...(node.init === null ? {} : { value: node.init }),
        })
      } else {
        bindings.push(...namesIn(node.id).map((name) => ({ name, at })))
      }
    },
  }).visit(program)

  /** The innermost scope around a place, a parameter's being its function, a function's not. */
  const scopeOf = (at: Span): Span =>
    scopes
      .filter((scope) => contains(scope, at) && (scope.start !== at.start || scope.end !== at.end))
      .reduce((inner, scope) => (sizeOf(scope) < sizeOf(inner) ? scope : inner), FILE)

  const scoped = bindings.map((binding) => ({ ...binding, scope: scopeOf(binding.at) }))

  /** The binding of `name` that a place sees: the one of the innermost scope around it. */
  const bindingOf = (name: string, at: number): (typeof scoped)[number] | undefined =>
    scoped
      .filter((binding) => binding.name === name && contains(binding.scope, { start: at, end: at }))
      .reduce<(typeof scoped)[number] | undefined>(
        (inner, binding) =>
          inner === undefined || sizeOf(binding.scope) < sizeOf(inner.scope) ? binding : inner,
        undefined,
      )
  const valueNamed = (name: string, at: number): Expression | undefined =>
    bindingOf(name, at)?.value

  /** The innermost function around a place. */
  const functionAround = (at: number): Span | undefined =>
    functions
      .filter((fn) => contains(fn, { start: at, end: at }))
      .reduce<Span | undefined>(
        (inner, fn) => (inner === undefined || sizeOf(fn) < sizeOf(inner) ? fn : inner),
        undefined,
      )

  /** What a function returns: an arrow's expression, or each `return` of its own body. */
  const returnedBy = (fn: Callable): Expression[] =>
    fn.body !== null && fn.body.type !== 'BlockStatement'
      ? [fn.body]
      : returns
          .filter(({ at }) => {
            const around = functionAround(at)

            return around?.start === fn.start && around.end === fn.end
          })
          .map(({ argument }) => argument)

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
    const resultOf = (fn: Callable): Alternative[] => {
      const returned = returnedBy(fn)

      return returned.length === 0 ? [null] : returned.flatMap(next)
    }

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
        return value.operator === '&&'
          ? [...next(value.right), null]
          : [...next(value.left), ...next(value.right)]
      case 'MemberExpression': {
        if (
          value.computed ||
          value.property.type !== 'Identifier' ||
          value.object.type === 'Super'
        ) {
          return [undefined]
        }

        const key = value.property.name

        return objectsOf(value.object, at, depth + 1).flatMap((object): Alternative[] => {
          if (object === null || object === undefined) {
            return [undefined]
          }

          const found = object.properties.findLast(
            (property) =>
              property.type === 'SpreadElement' ||
              (property.kind === 'init' && keyName(property.key, property.computed) === key),
          )

          if (found === undefined) {
            return [null]
          }

          return found.type === 'SpreadElement' ? [undefined] : next(found.value)
        })
      }
      case 'Identifier': {
        const declared = valueNamed(value.name, at)

        if (declared === undefined || isCallable(declared)) {
          return [undefined]
        }

        const hook = hooked(declared)

        if (hook === undefined) {
          return next(declared)
        }

        return hook.calls ? resultOf(hook.fn) : [undefined]
      }
      case 'CallExpression': {
        const declared =
          value.callee.type === 'Identifier' ? valueNamed(value.callee.name, at) : undefined
        const hook = declared === undefined ? undefined : hooked(declared)
        const fn =
          declared !== undefined && isCallable(declared)
            ? declared
            : hook !== undefined && !hook.calls
              ? hook.fn
              : undefined

        return fn === undefined ? [undefined] : resultOf(fn)
      }
      default:
        return [undefined]
    }
  }

  return {
    valueNamed,
    declares: (name, at) => bindingOf(name, at) !== undefined,
    objectsOf: (node, at) => objectsOf(node, at),
  }
}
