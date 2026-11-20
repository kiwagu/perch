/**
 * What a source file's names stand for, as far as the file itself says: the value a constant or a
 * function is declared with, read in the scope that declares it (`scopes.ts`), so a name resolves
 * as it does at runtime (an inner declaration, a parameter or a destructured name hides an outer
 * one; a loop's `let` or `const` binds in the loop, as each element of the value a `for…of`
 * iterates, a `catch` parameter in its clause, a `const` of a `case` in its `switch`), and every
 * object a value may be (`objectsOf`), for a spread's props (`spreads.ts`) and the event `can()`
 * names (`asked-event.ts`). A name of another file, or a value built at runtime, is an alternative
 * the file cannot follow, which each reader decides about itself; for such a value, the type the
 * file writes for it, where it writes one (`declaredTypeOf`, read by `declared-type.ts`).
 */

import type { Expression, ParamPattern, Program, TSType } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { type Alternative, alternativesIn, type Callable, DEPTH, type Member } from './alternatives'
import { namesIn, pathsIn, typedNamesIn, type WrittenType } from './binding-names'
import { type DeclaredTypes, declaredTypesIn } from './declared-type'
import { endIsReachable } from './reachable-end'
import { type Span, scopesIn } from './scopes'

/** A name a scope binds, with the value the file declares it with; none for a parameter. */
interface Binding {
  readonly name: string
  /** Where it is declared; its scope is the innermost scope around this place. */
  readonly at: Span
  readonly value?: Expression
  /** Whether a `const` declares it, so the value it is declared with is the one it holds. */
  readonly constant?: true
  /** For a destructured name or a `for…of` variable, what it is a part of (`Member`). */
  readonly member?: Member
  /** Its type as the file writes it, or the value a destructuring takes it from, and the keys. */
  readonly declared?: WrittenType | { readonly of: Expression; readonly path: readonly string[] }
}

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

const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

const sizeOf = ({ start, end }: Span): number => end - start

export function localsOf(program: Program): Locals {
  const functions: Span[] = []
  const bindings: Binding[] = []
  const returns: Array<{ readonly at: number; readonly argument: Expression | null }> = []
  /** Where each declarator of a `const` declaration starts. */
  const constants = new Set<number>()
  /** Where each `let` or `const` declarator of a `for…of` head starts, with the value it iterates. */
  const iterated = new Map<number, Expression>()
  const parameters = (node: Span & { readonly params: readonly ParamPattern[] }): void => {
    functions.push(node)
    bindings.push(
      ...node.params
        .flatMap(typedNamesIn)
        .map((typed) => ({ ...typed, at: { start: node.start, end: node.start } })),
    )
  }

  new Visitor({
    ForOfStatement: (node) => {
      // Its variable is each element of the value it iterates; a `var` outlives the loop.
      if (node.left.type === 'VariableDeclaration' && node.left.kind !== 'var') {
        for (const declarator of node.left.declarations) {
          iterated.set(declarator.start, node.right)
        }
      }
    },
    CatchClause: (node) => {
      const { param } = node

      if (param !== null) {
        bindings.push(
          ...namesIn(param).map((name) => ({ name, at: { start: param.start, end: param.end } })),
        )
      }
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
    VariableDeclaration: (node) => {
      if (node.kind === 'const') {
        for (const declarator of node.declarations) {
          constants.add(declarator.start)
        }
      }
    },
    VariableDeclarator: (node) => {
      const at = { start: node.start, end: node.end }
      // A `for…of` head's name is each element of the value it iterates, not a value of its own.
      const each = iterated.get(node.start)
      const object = each ?? node.init
      const part = each === undefined ? {} : { iterated: true as const }
      // A name's type is the one its annotation writes; a name a pattern without one destructures
      // has the type of the value destructured, by its keys (a `for…of` head's: none).
      const typed = new Map(typedNamesIn(node.id).map(({ name, declared }) => [name, declared]))
      const declaredOf = (name: string, path?: readonly string[]): Pick<Binding, 'declared'> => {
        const declared =
          typed.get(name) ??
          (path === undefined || each !== undefined || node.init === null
            ? undefined
            : { of: node.init, path })

        return declared === undefined ? {} : { declared }
      }

      if (node.id.type === 'Identifier') {
        bindings.push({
          name: node.id.name,
          at,
          ...(node.init === null ? {} : { value: node.init }),
          ...(constants.has(node.start) ? { constant: true as const } : {}),
          ...(each === undefined ? {} : { member: { object: each, path: [], iterated: true } }),
          ...declaredOf(node.id.name),
        })
      } else {
        bindings.push(
          ...pathsIn(node.id).map(({ name, path, defaulted }) => ({
            name,
            at,
            ...(path === undefined || object === null ? {} : { member: { object, path, ...part } }),
            ...(path === undefined || defaulted === true ? {} : declaredOf(name, path)),
          })),
        )
      }
    },
  }).visit(program)

  const scopes = scopesIn(program)
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

    if (declared === undefined) {
      return undefined
    }

    return declared.path.reduce<TSType | undefined>(
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
