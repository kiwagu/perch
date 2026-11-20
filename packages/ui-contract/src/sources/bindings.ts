/**
 * The names a source file binds, each in the scope that binds it (`scopes.ts`), with what the file
 * declares it with, for `locals.ts` to resolve a name where it is written: a parameter (typed where
 * its annotation says, `binding-names.ts`), a `catch` parameter, a function declaration's name, and
 * each name a variable declaration binds, with the value it is declared with, or the value it is
 * a part of (a destructured name, the variable of a `for…of`), and its written type. A `var` binds
 * in its function's body; a declaration a namespace's body exports binds in each body it is shared
 * with too.
 */

import type { Expression, ParamPattern, Program } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import type { Member } from './alternatives'
import { namesIn, pathsIn, typedNamesIn, type WrittenType } from './binding-names'
import { type Scopes, type Span, scopeAround } from './scopes'

/** A name a scope binds, with the value the file declares it with; none for a parameter. */
export interface Binding {
  readonly name: string
  /** Where it is declared. */
  readonly at: Span
  /** The scope it binds in. */
  readonly scope: Span
  readonly value?: Expression
  /** Whether a `const` declares it, so the value it is declared with is the one it holds. */
  readonly constant?: true
  /** For a destructured name or a `for…of` variable, what it is a part of (`Member`). */
  readonly member?: Member
  /** Its type as the file writes it, or the value a destructuring takes it from, and the keys. */
  readonly declared?: WrittenType | { readonly of: Expression; readonly path: readonly string[] }
}

export function bindingsIn(program: Program, scopes: Scopes): Binding[] {
  const bindings: Binding[] = []
  /** Where each declarator of a `const` or a `var` declaration starts, with its kind. */
  const kinds = new Map<number, 'const' | 'var'>()
  /** Where each `let` or `const` declarator of a `for…of` head starts, with the value it iterates. */
  const iterated = new Map<number, Expression>()
  /**
   * Binds the names a declaration at `at` declares: in its lexical scope, or a `var`'s; one a
   * namespace's body exports (`shared`, a function's or a variable's, never a parameter) in each
   * body it shares it with too.
   */
  const bind = (
    at: Span,
    hoisted: boolean,
    declared: ReadonlyArray<Omit<Binding, 'at' | 'scope'>>,
    shared = false,
  ): void => {
    const own = scopeAround(at, hoisted ? scopes.hoisting : scopes.lexical)

    for (const scope of [own, ...(shared ? scopes.sharedAt(at.start) : [])]) {
      bindings.push(...declared.map((binding) => ({ ...binding, at, scope })))
    }
  }
  const parameters = (node: Span & { readonly params: readonly ParamPattern[] }): void => {
    bind({ start: node.start, end: node.start }, false, node.params.flatMap(typedNamesIn))
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
    CatchClause: ({ param }) => {
      if (param !== null) {
        bind(
          param,
          false,
          namesIn(param).map((name) => ({ name })),
        )
      }
    },
    ArrowFunctionExpression: parameters,
    FunctionExpression: parameters,
    FunctionDeclaration: (node) => {
      parameters(node)

      if (node.id !== null) {
        bind(node, false, [{ name: node.id.name, value: node }], true)
      }
    },
    VariableDeclaration: (node) => {
      for (const declarator of node.declarations) {
        if (node.kind === 'const' || node.kind === 'var') {
          kinds.set(declarator.start, node.kind)
        }
      }
    },
    VariableDeclarator: (node) => {
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
      const at = { start: node.start, end: node.end }
      const hoisted = kinds.get(node.start) === 'var'

      if (node.id.type === 'Identifier') {
        bind(
          at,
          hoisted,
          [
            {
              name: node.id.name,
              ...(node.init === null ? {} : { value: node.init }),
              ...(kinds.get(node.start) === 'const' ? { constant: true as const } : {}),
              ...(each === undefined ? {} : { member: { object: each, path: [], iterated: true } }),
              ...declaredOf(node.id.name),
            },
          ],
          true,
        )
      } else {
        bind(
          at,
          hoisted,
          pathsIn(node.id).map(({ name, path, defaulted }) => ({
            name,
            ...(path === undefined || object === null ? {} : { member: { object, path, ...part } }),
            ...(path === undefined || defaulted === true ? {} : declaredOf(name, path)),
          })),
          true,
        )
      }
    },
  }).visit(program)

  return bindings
}
