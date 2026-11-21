/**
 * The names a source file binds, each in the innermost scope around its declaration (`scopes.ts`),
 * with what the file declares it with, for `locals.ts` to resolve a name where it is written: a
 * parameter (typed where its annotation says, `binding-names.ts`), a `catch` parameter, a function
 * declaration's name, and each name a variable declaration binds, with the value it is declared
 * with, or the value it is a part of (a destructured name, the `const` of a `for…of`), and its
 * written type. Only a `let` or a `const` binds in the cases of a `switch` or a class `static`
 * block; a `var` binds in the body of the function around it, a class `static` block or the file,
 * where the function's parameters are bound once more, since JavaScript takes a `var` and a
 * parameter of one name there for one variable (`Binding.variable`). In the order the file
 * declares them.
 */

import type {
  Expression,
  ForInStatement,
  ForOfStatement,
  FunctionBody,
  ParamPattern,
  Program,
  VariableDeclaration,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { namesIn, pathsIn, typedNamesIn, type WrittenType } from './binding-names'
import type { Member } from './names'
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
  /**
   * For a parameter or a `var`, which a function may declare again as the same variable: whether
   * this declaration gives it a value (`assigns`: an initializer or a loop's head; a `parameter`:
   * the argument) or keeps the one it has (`bare`: `var x`).
   */
  readonly variable?: 'parameter' | 'assigns' | 'bare'
}

export function bindingsIn(program: Program, scopes: Scopes): Binding[] {
  const bindings: Binding[] = []
  /** Where each declarator of a variable declaration starts, with its kind. */
  const kinds = new Map<number, VariableDeclaration['kind']>()
  /** Where each `const` declarator of a `for…of` head starts, with the value it iterates. */
  const iterated = new Map<number, Expression>()
  /** Where each `var` declarator of a `for…in` or a `for…of` head starts: the loop assigns it. */
  const looped = new Set<number>()
  const lexical = [...scopes.every, ...scopes.lexical]
  /** Binds the names a declaration at `at` declares in the innermost of `around` around it. */
  const bind = (
    at: Span,
    around: readonly Span[],
    declared: ReadonlyArray<Omit<Binding, 'at' | 'scope'>>,
  ): void => {
    const scope = scopeAround(at, around)

    bindings.push(...declared.map((binding) => ({ ...binding, at, scope })))
  }
  const parameters = (
    node: Span & {
      readonly params: readonly ParamPattern[]
      readonly body: FunctionBody | Expression | null
    },
  ): void => {
    const at = { start: node.start, end: node.start }
    const declared = node.params
      .flatMap(typedNamesIn)
      .map((binding) => ({ ...binding, variable: 'parameter' as const }))

    bind(at, scopes.every, declared)

    const { body } = node

    // In its body, where a `var` of its name declares it again.
    if (body?.type === 'BlockStatement') {
      bindings.push(...declared.map((binding) => ({ ...binding, at, scope: body })))
    }
  }
  const loop = (node: ForInStatement | ForOfStatement): void => {
    if (node.left.type === 'VariableDeclaration' && node.left.kind === 'var') {
      for (const declarator of node.left.declarations) {
        looped.add(declarator.start)
      }
    }
  }

  new Visitor({
    ForInStatement: loop,
    ForOfStatement: (node) => {
      loop(node)

      // Its `const` is each element of the value it iterates: the loop may assign a `let`
      // another value, and a `var` outlives it, so neither is followed.
      if (node.left.type === 'VariableDeclaration' && node.left.kind === 'const') {
        for (const declarator of node.left.declarations) {
          iterated.set(declarator.start, node.right)
        }
      }
    },
    CatchClause: ({ param }) => {
      if (param !== null) {
        bind(
          param,
          scopes.every,
          namesIn(param).map((name) => ({ name })),
        )
      }
    },
    ArrowFunctionExpression: parameters,
    FunctionExpression: parameters,
    FunctionDeclaration: (node) => {
      parameters(node)

      if (node.id !== null) {
        bind(node, scopes.every, [{ name: node.id.name, value: node }])
      }
    },
    VariableDeclaration: (node) => {
      for (const declarator of node.declarations) {
        kinds.set(declarator.start, node.kind)
      }
    },
    VariableDeclarator: (node) => {
      // A `for…of` head's `const` is each element of the value it iterates, no value of its own.
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
      const kind = kinds.get(node.start)
      // A `var` that neither an initializer nor a loop assigns keeps the value it has.
      const variable: Pick<Binding, 'variable'> =
        kind !== 'var'
          ? {}
          : { variable: node.init !== null || looped.has(node.start) ? 'assigns' : 'bare' }
      const around = kind === 'var' ? scopes.hoisting : lexical

      if (node.id.type === 'Identifier') {
        bind(at, around, [
          {
            name: node.id.name,
            ...(node.init === null ? {} : { value: node.init }),
            ...(kind === 'const' ? { constant: true as const } : {}),
            ...(each === undefined ? {} : { member: { object: each, path: [], iterated: true } }),
            ...declaredOf(node.id.name),
            ...variable,
          },
        ])
      } else {
        bind(
          at,
          around,
          pathsIn(node.id).map(({ name, path, defaulted }) => ({
            name,
            ...(path === undefined || object === null ? {} : { member: { object, path, ...part } }),
            ...(path === undefined || defaulted === true ? {} : declaredOf(name, path)),
            ...variable,
          })),
        )
      }
    },
  }).visit(program)

  return bindings
}
