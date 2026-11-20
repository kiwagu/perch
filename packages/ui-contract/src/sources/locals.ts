/**
 * What a source file's names stand for, as far as the file itself says: the value a constant or a
 * function is declared with, read in the scope that declares it, so a name resolves as it does at
 * runtime (an inner declaration, a parameter or a destructured name hides an outer one), and every
 * object a value may be (`objectsOf`), for a spread's props (`spreads.ts`) and the event `can()`
 * names (`asked-event.ts`). A name of another file, or a value built at runtime, is an alternative
 * the file cannot follow, which each reader decides about itself.
 */

import type { Expression, ParamPattern, Program } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { type Alternative, alternativesIn, type Callable } from './alternatives'
import { namesIn, pathsIn } from './binding-names'

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
  /** For a destructured name, the value destructured and the keys that lead to it. */
  readonly member?: { readonly object: Expression; readonly path: readonly string[] }
}

export interface Locals {
  /** What `name`, written at `at`, is declared with in the file (a function too), if it says. */
  valueNamed(name: string, at: number): Expression | undefined
  /** Whether the file binds `name` where it is written at `at`: declared, or a parameter. */
  declares(name: string, at: number): boolean
  /** What `node`, written at `at`, may be, each alternative once (`alternatives.ts`). */
  objectsOf(node: Expression, at: number): Alternative[]
}

const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

const sizeOf = ({ start, end }: Span): number => end - start

export function localsOf(program: Program): Locals {
  const scopes: Span[] = [FILE]
  const functions: Span[] = []
  const bindings: Binding[] = []
  const returns: Array<{ readonly at: number; readonly argument: Expression | null }> = []
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
      returns.push({ at: node.start, argument: node.argument })
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
        const { init } = node

        bindings.push(
          ...pathsIn(node.id).map(({ name, path }) => ({
            name,
            at,
            ...(path === undefined || init === null ? {} : { member: { object: init, path } }),
          })),
        )
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

  /**
   * What a function returns: an arrow's expression, or each `return` of its own body, `null` for a
   * bare `return` and for a body whose end it can reach (its last statement no `return` or `throw`).
   */
  const returnedBy = (fn: Callable): Array<Expression | null> => {
    if (fn.body === null) {
      return [null]
    }

    if (fn.body.type !== 'BlockStatement') {
      return [fn.body]
    }

    const last = fn.body.body.at(-1)
    const ends = last?.type === 'ReturnStatement' || last?.type === 'ThrowStatement'
    const own = returns.filter(({ at }) => {
      const around = functionAround(at)

      return around?.start === fn.start && around.end === fn.end
    })

    return [...own.map(({ argument }) => argument), ...(ends ? [] : [null])]
  }

  return {
    valueNamed,
    declares: (name, at) => bindingOf(name, at) !== undefined,
    objectsOf: alternativesIn({
      valueNamed,
      memberNamed: (name, at) => bindingOf(name, at)?.member,
      returnedBy,
    }),
  }
}
