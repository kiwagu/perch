/**
 * What a source file's names stand for, as far as the file itself says: the value a constant or a
 * function is declared with, read in the scope that binds it (`bindings.ts`, `scopes.ts`), so a
 * name resolves as it does at runtime (an inner declaration, a parameter or a destructured name
 * hides an outer one; a loop's `let` or `const` binds in the loop, as each element of the value a
 * `for…of` iterates, a `catch` parameter in its clause, a `let` or a `const` of a `case` in its
 * `switch` and of a class `static` block in it, while a `var` or a function binds in the innermost
 * block or function around it, and a namespace's names around the namespace; where one scope
 * binds a name twice, the first declaration is read), and every object a value may be
 * (`objectsOf`), for a spread's props (`spreads.ts`) and the event `can()` names
 * (`asked-event.ts`). A name of another file, or a value built at runtime, is an alternative
 * the file cannot follow, which each reader decides about itself; for such a value, the type the
 * file writes for it, where it writes one (`declaredTypeOf`, read by `declared-type.ts`).
 */

import type { Expression, Program, TSType } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { type Alternative, alternativesIn, type Callable, DEPTH } from './alternatives'
import { type Binding, bindingsIn } from './bindings'
import { type DeclaredTypes, declaredTypesIn } from './declared-type'
import { endIsReachable } from './reachable-end'
import { contains, type Span, scopesIn, sizeOf } from './scopes'

export interface Locals {
  /** What `name`, written at `at`, is declared with in the file (a function too), if it says. */
  valueNamed(name: string, at: number): Expression | undefined
  /** The value of `name`, written at `at`, where a `const` declares it: it never holds another. */
  constantNamed(name: string, at: number): Expression | undefined
  /** Whether the file binds `name` where it is written at `at`: declared, or a parameter. */
  declares(name: string, at: number): boolean
  /** What `node`, written at `at`, may be, each alternative once (`alternatives.ts`). */
  objectsOf(node: Expression, at: number): Alternative[]
  /**
   * The type the file writes for `node`, written at `at`: for a name, its annotation (a parameter,
   * a variable, a name an annotated pattern destructures, by its keys) or the type of the value a
   * destructuring takes it from (`const { draft } = props`), by its keys; for a non-computed member
   * of such a value, its key's (`props.draft`). None for anything else.
   */
  declaredTypeOf(node: Expression, at: number): TSType | undefined
  /** What the file's type declarations say of a type (`declared-type.ts`). */
  readonly types: DeclaredTypes
}

export function localsOf(program: Program): Locals {
  const bindings = bindingsIn(program, scopesIn(program))
  const functions: Span[] = []
  const returns: Array<{ readonly at: number; readonly argument: Expression | null }> = []
  const fn = (node: Span): void => {
    functions.push(node)
  }

  new Visitor({
    ReturnStatement: (node) => {
      returns.push({ at: node.start, argument: node.argument })
    },
    ArrowFunctionExpression: fn,
    FunctionExpression: fn,
    FunctionDeclaration: fn,
  }).visit(program)

  /**
   * The binding of `name` that a place sees: the one of the innermost scope around it, the first
   * the file declares where that scope binds the name twice.
   */
  const bindingOf = (name: string, at: number): Binding | undefined =>
    bindings
      .filter((binding) => binding.name === name && contains(binding.scope, { start: at, end: at }))
      .reduce<Binding | undefined>(
        (inner, binding) =>
          inner === undefined || sizeOf(binding.scope) < sizeOf(inner.scope) ? binding : inner,
        undefined,
      )
  const valueNamed = (name: string, at: number): Expression | undefined =>
    bindingOf(name, at)?.value
  const constantNamed = (name: string, at: number): Expression | undefined => {
    const binding = bindingOf(name, at)

    return binding?.constant === true ? binding.value : undefined
  }

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
   * bare `return` and for a body whose end it can reach (`endIsReachable`: no `return` or `throw`
   * ends it, in a block or in both arms of an `if` and `else`).
   */
  const returnedBy = (fn: Callable): Array<Expression | null> => {
    if (fn.body === null) {
      return [null]
    }

    if (fn.body.type !== 'BlockStatement') {
      return [fn.body]
    }

    const own = returns.filter(({ at }) => {
      const around = functionAround(at)

      return around?.start === fn.start && around.end === fn.end
    })

    return [...own.map(({ argument }) => argument), ...(endIsReachable(fn.body) ? [null] : [])]
  }

  const types = declaredTypesIn(program)
  const declaredTypeOf = (node: Expression, at: number, depth = 0): TSType | undefined => {
    if (depth >= DEPTH) {
      return undefined
    }

    if (node.type === 'MemberExpression') {
      const { object, property } = node

      if (node.computed || object.type === 'Super' || property.type !== 'Identifier') {
        return undefined
      }

      const outer = declaredTypeOf(object, at, depth + 1)

      return outer === undefined ? undefined : types.memberOf(outer, property.name)
    }

    const declared = node.type === 'Identifier' ? bindingOf(node.name, at)?.declared : undefined

    return declared?.path.reduce<TSType | undefined>(
      (outer, key) => (outer === undefined ? undefined : types.memberOf(outer, key)),
      'type' in declared
        ? declared.type
        : declaredTypeOf(declared.of, declared.of.start, depth + 1),
    )
  }

  return {
    valueNamed,
    constantNamed,
    declares: (name, at) => bindingOf(name, at) !== undefined,
    declaredTypeOf: (node, at) => declaredTypeOf(node, at),
    types,
    objectsOf: alternativesIn({
      valueNamed,
      constantNamed,
      memberNamed: (name, at) => bindingOf(name, at)?.member,
      returnedBy,
    }),
  }
}
